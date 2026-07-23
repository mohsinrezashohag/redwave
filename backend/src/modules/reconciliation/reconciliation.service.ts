/**
 * ReconciliationService — finance's integrity tie-out. Two INDEPENDENT read-only checks (never joining the
 * two rate streams, #3): (1) statement tie-out — frozen statement total = Σ its lines = Σ the live re-priced
 * confirmed sales (a drift means the statement is stale); (2) pay-run tie-out — each line's net = its
 * components, run total = Σ net. Flags any discrepancy. — SRS §12 (reconciliation)
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { formatMoney, sumMoney } from '../../common/money/money';
import { StatementService } from '../billing/statement.service';
import { tieOutPayRunLine, tieOutStatement } from './reconciliation.logic';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementService,
  ) {}

  /** Tie the CURRENT (issued) statement for a client + BILLING WEEK to its lines and to a live re-price. */
  async statementTieOut(clientId: string, billingPeriodId: string) {
    const statement = await this.prisma.clientStatement.findFirst({
      where: { client_id: clientId, billing_period_id: billingPeriodId, status: 'issued' },
      include: { lines: { select: { line_total: true } } },
    });

    // Live re-price now (billing stream only). May 422 if a product lost its rate since issue → null.
    let liveTotal: string | null = null;
    try {
      const { draft } = await this.statements.priceClientPeriod(clientId, billingPeriodId);
      liveTotal = formatMoney(draft.total_amount);
    } catch {
      liveTotal = null;
    }

    if (!statement) {
      return {
        client_id: clientId,
        billing_period_id: billingPeriodId,
        statement: null,
        frozen_total: '0.00',
        lines_sum: '0.00',
        live_total: liveTotal,
        total_equals_lines: true,
        statement_matches_live: false,
        ok: false,
        discrepancies: ['No issued statement for this client and billing week — generate one.'],
      };
    }

    const tie = tieOutStatement({
      frozenTotal: statement.total_amount.toString(),
      lineTotals: statement.lines.map((l) => l.line_total.toString()),
      liveTotal: liveTotal === null ? null : liveTotal,
    });
    return {
      client_id: clientId,
      billing_period_id: billingPeriodId,
      statement: { id: statement.id, statement_number: statement.statement_number, status: statement.status },
      ...tie,
    };
  }

  /** Tie a pay run: each line's net = its components; run total = Σ net. */
  async payRunTieOut(runId: string) {
    const run = await this.prisma.payRun.findUnique({ where: { id: runId }, select: { id: true, status: true } });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    const lines = await this.prisma.payRunLine.findMany({
      where: { pay_run_id: runId },
      include: { rep: { select: { rep_code: true } } },
      orderBy: { rep: { rep_code: 'asc' } },
    });
    const checked = lines.map((l) =>
      tieOutPayRunLine({
        rep_id: l.rep_id,
        rep_code: l.rep.rep_code,
        commission_70: l.commission_70.toString(),
        holdback_release_30: l.holdback_release_30.toString(),
        expense_total: l.expense_total.toString(),
        incentive_total: l.incentive_total.toString(),
        bonus_amount: l.bonus_amount.toString(),
        clawback_total: l.clawback_total.toString(),
        net_payout: l.net_payout.toString(),
      }),
    );
    const run_total = formatMoney(sumMoney(lines.map((l) => l.net_payout.toString())));
    const discrepancies = checked.filter((c) => !c.ok);
    return {
      pay_run_id: runId,
      status: run.status,
      line_count: lines.length,
      run_total,
      ok: discrepancies.length === 0,
      discrepancies,
    };
  }
}
