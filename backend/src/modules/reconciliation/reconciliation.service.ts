/**
 * ReconciliationService — finance's integrity tie-out. THREE INDEPENDENT read-only checks (never joining the
 * two rate streams, #3): (1) statement tie-out — frozen statement total = Σ its lines = Σ the live re-priced
 * confirmed sales (a drift means the statement is stale); (2) pay-run tie-out — each line's net = its
 * components, run total = Σ net; (3) client EXPENSE document tie-out — frozen CEXP total = Σ its frozen
 * line detail = the live re-derive. Each stays a separate check over its own stream: an expense document
 * bills reimbursable rep expenses on to the client and has its own selection and its own number sequence.
 * Flags any discrepancy. — SRS §12 (reconciliation)
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { formatMoney, sumMoney } from '../../common/money/money';
import { StatementService } from '../billing/statement.service';
import { ClientExpenseDocService } from '../billing/expense-doc.service';
import { tieOutExpenseDoc, tieOutPayRunLine, tieOutStatement } from './reconciliation.logic';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementService,
    private readonly expenseDocs: ClientExpenseDocService,
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

  /**
   * Tie the CURRENT (issued) client EXPENSE document for a client + PAY PERIOD to its frozen line detail and
   * to a live re-derive. Note the calendar: an expense document is keyed by the PAY period (an item's period
   * comes from its own expense_date), NOT the Mon–Sun billing week a statement uses — the two calendars are
   * never substituted for one another (§14 rule 1).
   */
  async expenseDocTieOut(clientId: string, payPeriodId: string) {
    const doc = await this.prisma.clientExpenseDocument.findFirst({
      where: { client_id: clientId, pay_period_id: payPeriodId, status: 'issued' },
      select: { id: true, document_number: true, status: true, total_amount: true, line_detail: true },
    });

    // Live re-derive now. May 422 when a km item's client rate went missing since issue → null, which is
    // reported rather than silently passed.
    let liveTotal: string | null = null;
    try {
      const preview = await this.expenseDocs.preview(clientId, payPeriodId);
      liveTotal = preview.total_amount;
    } catch {
      liveTotal = null;
    }

    if (!doc) {
      return {
        client_id: clientId,
        pay_period_id: payPeriodId,
        document: null,
        document_number: null,
        frozen_total: '0.00',
        lines_sum: '0.00',
        live_total: liveTotal,
        total_equals_lines: true,
        document_matches_live: false,
        ok: false,
        discrepancies: ['No issued expense document for this client and pay period — generate one.'],
      };
    }

    // `line_detail` is a frozen jsonb snapshot; read its amounts defensively rather than trusting the shape.
    const lines = Array.isArray(doc.line_detail) ? (doc.line_detail as { amount?: unknown }[]) : [];
    const lineAmounts = lines
      .map((l) => (typeof l?.amount === 'string' || typeof l?.amount === 'number' ? String(l.amount) : null))
      .filter((a): a is string => a !== null);

    const tie = tieOutExpenseDoc({
      documentNumber: doc.document_number,
      frozenTotal: doc.total_amount.toString(),
      lineAmounts,
      liveTotal,
    });
    return {
      client_id: clientId,
      pay_period_id: payPeriodId,
      document: { id: doc.id, document_number: doc.document_number, status: doc.status },
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
