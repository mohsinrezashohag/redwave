/**
 * PayRunService — the orchestrator. COMPOSES the config provider + commission engine + sales; it
 * never reimplements tier/commission math (#5). Draft = preview (nothing frozen). Finalize = the
 * money action: ATOMIC + IDEMPOTENT (#8), freezes immutable snapshots (#2), transitions sales
 * Validated→In Pay Run→Paid (§16), applies bonuses, composes net. NO HOLDBACK (client decision 2026-11-13):
 * commission is paid in full, no hold is recorded and no older hold is released; holds are handled offline.
 * — SRS §9 (PAY-001..011), arch §9
 *
 * Idempotency is STATE-BASED (pay_runs has no key column): re-finalizing a non-draft run is a no-op,
 * and the freeze is further guarded (sales become Paid).
 * Money math uses decimal.js; conversion to Prisma Decimal (`.toFixed(2)`) happens only on write.
 */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AvatarService } from '../../common/avatar/avatar.service';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CommissionConfigProvider } from '../commission/commission-config.provider';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { ActivationInput } from '../engine/engine.types';
import { mapToEngineProductType, toActivationInput } from './activation-mapping.logic';
import { buildPayrollReport, PayrollSaleInput } from './payroll-report.logic';

/**
 * Exactly what a payroll line needs off a sale — written out rather than derived, so the list is a
 * readable statement of the report's inputs. Note what is ABSENT: nothing from the client-billing stream
 * appears here, and nothing downstream can reach it (#3).
 */
type SalesForPayroll = {
  id: string;
  sale_date: Date;
  customer_name: string;
  street: string | null;
  city: string | null;
  province_state: string | null;
  postal_code: string | null;
  is_greenfield: boolean;
  rep: { rep_code: string; external_code: string | null; full_name: string } | null;
  client: { client_code: string } | null;
  sale_items: { id: string; product_type: string; counts_toward_tally: boolean; product: { name: string } | null }[];
}[];
import { buildLineAmounts, computeNet } from './line-amounts.logic';
import { EXPENSE_TOTAL_PROVIDER, ExpenseTotalProvider } from './seams/expense-total.provider';
import { CLAWBACK_TOTAL_PROVIDER, ClawbackTotalProvider } from './seams/clawback-total.provider';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { CreatePayRunDto } from './dto/create-pay-run.dto';
import { SetBonusDto } from './dto/bonus.dto';
import { ExportPayRunDto } from './dto/export.dto';

/**
 * The sale shape behind a PAYROLL REPORT line: the agent as the workbook keys them (external_code), the
 * channel, and the product name. Shared by finalize and `backfillPayrollLines` so both build the line from
 * the same data. Rep-pay stream only — nothing here reaches the client-billing rate tables (#3).
 */
const PAYROLL_SALE_INCLUDE = {
  sale_items: { include: { product: { select: { name: true } } } },
  rep: { select: { rep_code: true, external_code: true, full_name: true } },
  client: { select: { client_code: true } },
} satisfies Prisma.SaleInclude;

const iso = (date: Date): string => date.toISOString().slice(0, 10);
/** A run whose snapshots are frozen — the only runs that have (or should have) payroll lines. */
const isFinalizedStatus = (status: string): boolean => status === 'finalized' || status === 'exported';
const dec = (value: { toString(): string }): Decimal => new Decimal(value.toString());
const money = (value: Decimal): string => value.toFixed(2);
const nonZero = (value: { toString(): string } | null | undefined): boolean => value != null && !dec(value).isZero();

/** What `backfillPayrollLines` did (or would do, in a dry run) for one run. */
export interface PayrollBackfillResult {
  pay_run_id: string;
  period_number: number;
  outcome: 'written' | 'would_write' | 'skipped_has_lines';
  reps: { rep_code: string; sales: number; gross: string; advance_70: string; held_30: string }[];
}

type PayPeriodRow ={ id: string; start_date: Date; end_date: Date; payday: Date };
type RepBonus = { amount: Decimal; note: string | null };

@Injectable()
export class PayRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly config: CommissionConfigProvider,
    private readonly engine: CommissionEngineService,
    @Inject(EXPENSE_TOTAL_PROVIDER) private readonly expenseSeam: ExpenseTotalProvider,
    @Inject(CLAWBACK_TOTAL_PROVIDER) private readonly clawbackSeam: ClawbackTotalProvider,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
    @Optional() private readonly avatars?: AvatarService,
  ) {}

  // ── Draft ───────────────────────────────────────────────────────────────────────────────────

  async createDraft(dto: CreatePayRunDto, user: AuthUser) {
    const period = await this.prisma.payPeriod.findUnique({ where: { id: dto.pay_period_id } });
    if (!period) {
      throw new NotFoundException('Pay period not found');
    }
    const finalized = await this.prisma.payRun.findFirst({
      where: { pay_period_id: period.id, status: { in: ['finalized', 'exported'] } },
    });
    if (finalized) {
      throw new ConflictException('a finalized pay run already exists for this period');
    }
    const run =
      (await this.prisma.payRun.findFirst({
        where: { pay_period_id: period.id, status: 'draft' },
      })) ??
      (await this.prisma.payRun.create({
        data: {
          pay_period_id: period.id,
          run_date: new Date(),
          status: 'draft',
          executed_by: user.id,
        },
      }));

    await this.computeDraftLines(run.id, period, user);
    await this.audit.log({
      actorId: user.id,
      entityType: 'pay_runs',
      entityId: run.id,
      action: 'create',
      after: { pay_period_id: period.id, status: 'draft' },
    });
    return this.getRun(run.id, user);
  }

  private async computeDraftLines(runId: string, period: PayPeriodRow, user: AuthUser) {
    const reps = await this.repsWithValidatedSales(period, await this.scopeRepIds(user));
    const existingBonuses = await this.bonusesByRep(runId);
    const config = await this.config.getEngineConfig(iso(period.end_date)); // once per run, as-of close

    await this.prisma.$transaction(
      async (tx) => {
        await tx.payRunLine.deleteMany({ where: { pay_run_id: runId } });
        for (const repId of reps) {
          const { result } = await this.gatherAndRun(tx, repId, period, config);
          const bonus = existingBonuses.get(repId) ?? { amount: new Decimal(0), note: null };
          const amounts = buildLineAmounts(result, {
            released: new Decimal(0), // no holdback: nothing is ever released (2026-11-13)
            expense: await this.expenseSeam.getApprovedExpenseTotal(repId, period.id),
            bonus: bonus.amount,
            clawback: await this.clawbackSeam.getClawbackTotal(repId, period.id),
          });
          await tx.payRunLine.create({ data: this.lineData(runId, repId, amounts, bonus.note) });
        }
      },
      { timeout: 60_000 },
    );
  }

  // ── Bonus (draft only) ────────────────────────────────────────────────────────────────────────

  async setBonus(runId: string, lineId: string, dto: SetBonusDto, user: AuthUser) {
    const run = await this.prisma.payRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    if (run.status !== 'draft') {
      throw new ConflictException('bonuses can only be set on a draft run');
    }
    const line = await this.prisma.payRunLine.findFirst({
      where: { id: lineId, pay_run_id: runId },
    });
    if (!line) {
      throw new NotFoundException('Pay run line not found');
    }
    const bonus = new Decimal(dto.amount);
    const net = computeNet({
      advance: dec(line.commission_70),
      released: dec(line.holdback_release_30),
      expense: dec(line.expense_total),
      incentive: dec(line.incentive_total),
      bonus,
      clawback: dec(line.clawback_total),
    });
    const updated = await this.prisma.payRunLine.update({
      where: { id: lineId },
      data: { bonus_amount: money(bonus), bonus_note: dto.note ?? null, net_payout: money(net) },
      // Include rep so the bonus response is a full PayRunLine (uniform with getLines). — Batch A #2
      include: { rep: { select: { id: true, rep_code: true, full_name: true } } },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'pay_run_lines',
      entityId: lineId,
      action: 'bonus',
      after: { bonus_amount: money(bonus), note: dto.note ?? null },
    });
    return updated;
  }

  // ── Finalize (atomic + idempotent) ────────────────────────────────────────────────────────────

  async finalize(runId: string, user: AuthUser) {
    const run = await this.prisma.payRun.findUnique({
      where: { id: runId },
      include: { pay_period: true },
    });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    // STATE-BASED IDEMPOTENCY: re-finalizing a non-draft run is a no-op (no double-pay/-freeze). (#8)
    if (run.status !== 'draft') {
      return this.getRun(runId, user);
    }

    const period = run.pay_period;
    const reps = await this.repsWithValidatedSales(period, await this.scopeRepIds(user));
    const existingBonuses = await this.bonusesByRep(run.id);
    const config = await this.config.getEngineConfig(iso(period.end_date));

    // Collected during the tx; emitted AFTER it commits (best-effort, never inside the money tx).
    const notices: { repId: string; net: Decimal }[] = [];

    // EVERYTHING in one transaction — a mid-step throw rolls back entirely (no partial pay run). (#8)
    await this.prisma.$transaction(
      async (tx) => {
        await tx.payRunLine.deleteMany({ where: { pay_run_id: run.id } });

        for (const repId of reps) {
          const { result, sales } = await this.gatherAndRun(tx, repId, period, config);

          // (a) FREEZE the immutable snapshots onto each sale_item (#2).
          for (const item of result.items) {
            await tx.saleItem.update({
              where: { id: item.id },
              data: {
                tier_at_payment: item.tierAtPayment,
                rate_applied: money(item.rateApplied),
                commission_paid: money(item.commissionPaid),
                incentive_id: item.incentiveId,
                incentive_amount: money(item.incentiveAmount),
              },
            });
          }

          // (a2) Freeze the PAYROLL REPORT lines from the SAME engine result, so the report and the
          // snapshots can never disagree. Re-finalize is guarded, but clear first so a re-run cannot
          // double the rows.
          await tx.payrollReportLine.deleteMany({
            where: { pay_run_id: run.id, sale_id: { in: sales.map((s2) => s2.id) } },
          });
          await this.writePayrollLines(tx, run.id, sales, result, config.holdback.advancePct);

          // (b) Transition the rep's sales Validated → in_pay_run → paid (§16).
          const saleIds = sales.map((s) => s.id);
          if (saleIds.length > 0) {
            await tx.sale.updateMany({
              where: { id: { in: saleIds } },
              data: { status: 'in_pay_run', pay_run_id: run.id },
            });
            await tx.sale.updateMany({ where: { id: { in: saleIds } }, data: { status: 'paid' } });
          }

          // (c/d) NO HOLDBACK (client decision 2026-11-13): nothing is held and no older hold is released (any
          // still waiting were marked settled_offline by migration). The full clawback deducts from net: a flat
          // deduction with no sequencing. — CLAUDE §3 #6
          const clawback = await this.clawbackSeam.getClawbackTotal(repId, period.id);

          // (e/f) Compose net via the seams + bonus.
          const expense = await this.expenseSeam.getApprovedExpenseTotal(repId, period.id);
          const bonus = existingBonuses.get(repId) ?? { amount: new Decimal(0), note: null };
          const amounts = buildLineAmounts(result, {
            released: new Decimal(0),
            expense,
            bonus: bonus.amount,
            clawback,
          });
          await tx.payRunLine.create({ data: this.lineData(run.id, repId, amounts, bonus.note) });
          notices.push({ repId, net: amounts.net_payout });

          // (h) Atomically mark the rep's pending clawbacks applied + linked to this run (CLAW-006/008).
          // Read total (above) and mark are the same pending set in one transaction — never double-deducted.
          await this.clawbackSeam.markApplied(repId, period.id, run.id, tx);
        }

        // (g) Mark the run finalized and the period paid.
        await tx.payRun.update({ where: { id: run.id }, data: { status: 'finalized' } });
        await tx.payPeriod.update({ where: { id: period.id }, data: { status: 'paid' } });
      },
      { timeout: 120_000 },
    );

    await this.audit.log({
      actorId: user.id,
      entityType: 'pay_runs',
      entityId: run.id,
      action: 'finalize',
      after: { pay_period_id: period.id, rep_count: reps.length },
    });

    // Best-effort, post-commit: notify each paid rep. — pay_run_finalized
    const repUsers = await this.prisma.rep.findMany({
      where: { id: { in: notices.map((n) => n.repId) } },
      select: { id: true, user_id: true },
    });
    const userByRep = new Map(repUsers.map((r) => [r.id, r.user_id]));
    const periodNo = String(period.period_number);
    for (const n of notices) {
      const userId = userByRep.get(n.repId);
      await this.emitter.emitMany([userId], {
        eventType: 'pay_run_finalized',
        title: 'Your pay is ready',
        body: `Pay period ${periodNo} is finalized. Net payout ${money(n.net)}.`,
        relatedEntityType: 'pay_runs',
        relatedEntityId: run.id,
        variables: { period_number: periodNo, net_payout: money(n.net) },
      });
    }
    return this.getRun(runId, user);
  }

  // ── Export (ADP; status + audit record — no dedicated table) ──────────────────────────────────

  /**
   * The PAYROLL REPORT for a run — Redwave's own workbook shape, read from the FROZEN lines.
   *
   * Read-only and never re-priced (#2): the lines were written at finalize from the same engine result
   * that froze the snapshots. A run that has not finalized has no lines, and that is reported honestly as
   * an empty report rather than by computing what is not yet owed.
   *
   * Rep-pay stream only — nothing here touches the client-billing rate tables (#3).
   */
  async payrollReport(runId: string, user: AuthUser) {
    const run = await this.prisma.payRun.findUnique({
      where: { id: runId },
      include: { pay_period: true },
    });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    await this.scopeRepIds(user); // permission-shaped read; the run itself is admin-scoped like the rest

    const lines = await this.prisma.payrollReportLine.findMany({
      where: { pay_run_id: runId },
      orderBy: { sort_order: 'asc' },
    });

    const sum = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) =>
      lines.reduce((acc, l) => acc.plus(pick(l)), new Prisma.Decimal(0)).toFixed(2);

    return {
      pay_run_id: run.id,
      period_number: run.pay_period.period_number,
      period_start: iso(run.pay_period.start_date),
      period_end: iso(run.pay_period.end_date),
      run_status: run.status,
      // No holdback since 2026-11-13. An OLD run finalized with a hold keeps its frozen 70% / 30% columns:
      // has_holdback says whether to show them, and split labels them with the split that run used.
      has_holdback: lines.some((l) => !l.holdback_30.isZero()),
      split: await this.config.getHoldbackSplit(iso(run.pay_period.end_date)),
      // From the run's STATUS, not from whether lines exist: a run finalized before payroll lines existed
      // (packet 02) has none until `backfillPayrollLines` runs, and must not claim "not finalized".
      is_finalized: isFinalizedStatus(run.status),
      lines: lines.map((l) => ({
        sale_id: l.sale_id,
        sale_date: l.sale_date ? iso(l.sale_date) : null,
        rep_external_code: l.rep_external_code,
        rep_code: l.rep_code,
        rep_name: l.rep_name,
        customer_name: l.customer_name,
        address: l.address,
        channel: l.channel,
        product_name: l.product_name,
        has_internet: l.has_internet,
        has_tv: l.has_tv,
        has_home_phone: l.has_home_phone,
        is_greenfield: l.is_greenfield,
        internet_rate: (l.internet_rate ?? new Prisma.Decimal(0)).toFixed(2),
        tv_rate: (l.tv_rate ?? new Prisma.Decimal(0)).toFixed(2),
        hp_rate: (l.hp_rate ?? new Prisma.Decimal(0)).toFixed(2),
        greenfield: (l.greenfield ?? new Prisma.Decimal(0)).toFixed(2),
        spiff: (l.spiff ?? new Prisma.Decimal(0)).toFixed(2),
        other_total: (l.other_total ?? new Prisma.Decimal(0)).toFixed(2),
        total_100: l.total_100.toFixed(2),
        advance_70: l.advance_70.toFixed(2),
        holdback_30: l.holdback_30.toFixed(2),
      })),
      total_100: sum((l) => l.total_100),
      advance_70: sum((l) => l.advance_70),
      holdback_30: sum((l) => l.holdback_30),
    };
  }

  /**
   * ONE REP's pay statement for a run — what was sold and what it paid (an old run also shows its 70/30).
   *
   * Built from the SAME frozen `payroll_report_lines` as the payroll report, filtered to one rep, so the
   * two reconcile by construction rather than by agreement between two calculations (#2). Nothing is
   * recomputed.
   *
   * SELF-SCOPING IS RESOLVED FROM THE TOKEN, never from a caller-supplied id — see `myPayStatement`, which
   * takes no repId at all. This admin-facing method DOES take one, and is gated by `payrun:view`, which a
   * rep does not have.
   *
   * #3 — the returned shape carries no client rate, no margin and no org-wide total. A rep-facing document
   * is the rep stream only.
   */
  private async buildRepStatement(runId: string, repId: string) {
    const run = await this.prisma.payRun.findUnique({
      where: { id: runId },
      include: { pay_period: true },
    });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }

    const lines = await this.prisma.payrollReportLine.findMany({
      where: { pay_run_id: runId, sale_id: { in: (await this.saleIdsForRep(runId, repId)) } },
      orderBy: { sort_order: 'asc' },
    });

    const rep = await this.prisma.rep.findUnique({
      where: { id: repId },
      select: { rep_code: true, external_code: true, full_name: true },
    });

    const sum = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) =>
      lines.reduce((acc, l) => acc.plus(pick(l)), new Prisma.Decimal(0)).toFixed(2);

    return {
      pay_run_id: run.id,
      period_number: run.pay_period.period_number,
      period_start: iso(run.pay_period.start_date),
      period_end: iso(run.pay_period.end_date),
      rep_code: rep?.rep_code ?? null,
      rep_name: rep?.full_name ?? null,
      // Only an OLD run finalized with a hold shows the "Your x%" / "Held y%" columns (2026-11-13).
      has_holdback: lines.some((l) => !l.holdback_30.isZero()),
      split: await this.config.getHoldbackSplit(iso(run.pay_period.end_date)),
      // Lines are empty until the run finalizes — before that nothing is owed, and a zeroed statement would
      // read as "you earned nothing" rather than "not yet calculated". The flag itself comes from the run's
      // STATUS, so a finalized run with no recorded lines says so honestly instead of "not finalized".
      is_finalized: isFinalizedStatus(run.status),
      lines: lines.map((l) => ({
        sale_id: l.sale_id,
        sale_date: l.sale_date ? iso(l.sale_date) : null,
        customer_name: l.customer_name,
        address: l.address,
        channel: l.channel,
        product_name: l.product_name,
        has_internet: l.has_internet,
        has_tv: l.has_tv,
        has_home_phone: l.has_home_phone,
        is_greenfield: l.is_greenfield,
        // The REP amount for each component — never a client rate (#3).
        internet_rate: (l.internet_rate ?? new Prisma.Decimal(0)).toFixed(2),
        tv_rate: (l.tv_rate ?? new Prisma.Decimal(0)).toFixed(2),
        hp_rate: (l.hp_rate ?? new Prisma.Decimal(0)).toFixed(2),
        greenfield: (l.greenfield ?? new Prisma.Decimal(0)).toFixed(2),
        spiff: (l.spiff ?? new Prisma.Decimal(0)).toFixed(2),
        other_total: (l.other_total ?? new Prisma.Decimal(0)).toFixed(2),
        total_100: l.total_100.toFixed(2),
        advance_70: l.advance_70.toFixed(2),
        holdback_30: l.holdback_30.toFixed(2),
      })),
      total_100: sum((l) => l.total_100),
      advance_70: sum((l) => l.advance_70),
      holdback_30: sum((l) => l.holdback_30),
    };
  }

  /**
   * OPERATOR BACKFILL — rebuild `payroll_report_lines` for a run that was finalized BEFORE that table
   * existed (packet 02, migration 20260704000000). Without it, such a run's pay statements and payroll
   * workbook are empty although the run was paid.
   *
   * Built ONLY from the frozen snapshots — `sale_items.rate_applied` + `incentive_amount`, the exact two
   * values finalize hands `writePayrollLines` from the engine result. The engine is NOT re-run, so the
   * period is never re-tiered (#5); no snapshot is written (#2); no client rate is read (#3).
   *
   * Safe by construction:
   *   - only `finalized`/`exported` runs; a run that already has ANY line is skipped (idempotent, and a
   *     finalize-written run is never touched);
   *   - RECONCILED before writing: per rep, Σ rate_applied must equal the frozen `pay_run_lines`
   *     gross_commission, and its 70% (half-up, the engine's split rule) must equal commission_70. Any
   *     mismatch throws and the run's transaction writes nothing;
   *   - one `$transaction` per run (#8), one audit row per run.
   *
   * `dryRun` performs every read and every check, and writes nothing.
   */
  async backfillPayrollLines(
    runId: string,
    opts: { dryRun: boolean; actorId: string },
  ): Promise<PayrollBackfillResult> {
    const run = await this.prisma.payRun.findUnique({ where: { id: runId }, include: { pay_period: true } });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    if (!isFinalizedStatus(run.status)) {
      throw new ConflictException('only a finalized pay run has payroll lines to backfill');
    }
    const base = { pay_run_id: run.id, period_number: run.pay_period.period_number };

    const existing = await this.prisma.payrollReportLine.count({ where: { pay_run_id: run.id } });
    if (existing > 0) {
      return { ...base, outcome: 'skipped_has_lines', reps: [] };
    }

    const config = await this.config.getEngineConfig(iso(run.pay_period.end_date)); // as-of close, like finalize
    const advancePct = config.holdback.advancePct;

    const [runLines, sales] = await Promise.all([
      this.prisma.payRunLine.findMany({
        where: { pay_run_id: run.id },
        include: { rep: { select: { rep_code: true } } },
      }),
      this.prisma.sale.findMany({ where: { pay_run_id: run.id }, include: PAYROLL_SALE_INCLUDE }),
    ]);

    // Per rep: the snapshot items in the shape `writePayrollLines` takes from the engine result.
    const plans = runLines.map((line) => {
      const repSales = sales.filter((s) => s.rep_id === line.rep_id);
      const items = repSales.flatMap((s) =>
        s.sale_items
          .filter((i) => i.commission_paid !== null) // not frozen ⇒ was not paid in this run
          .map((i) => ({
            id: i.id,
            productType: i.product_type,
            rateApplied: dec(i.rate_applied ?? 0),
            incentiveAmount: dec(i.incentive_amount ?? 0),
          })),
      );
      const gross = items.reduce((acc, i) => acc.plus(i.rateApplied), new Decimal(0));
      const advance = gross.times(dec(advancePct)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      const frozenGross = line.gross_commission === null ? null : dec(line.gross_commission);
      if ((frozenGross && !gross.equals(frozenGross)) || !advance.equals(dec(line.commission_70))) {
        throw new ConflictException(
          `payroll backfill refused for run #${run.pay_period.period_number}, rep ${line.rep.rep_code}: ` +
            `snapshots give gross ${money(gross)} / 70% ${money(advance)}, but the frozen pay-run line has ` +
            `gross ${frozenGross ? money(frozenGross) : '—'} / 70% ${money(dec(line.commission_70))}`,
        );
      }
      return {
        repSales,
        items,
        summary: {
          rep_code: line.rep.rep_code,
          sales: repSales.length,
          gross: money(gross),
          advance_70: money(dec(line.commission_70)),
          held_30: money(gross.minus(dec(line.commission_70))),
        },
      };
    });

    // A paid sale whose rep has no pay-run line would be silently dropped — refuse instead.
    const covered = new Set(runLines.map((l) => l.rep_id));
    const orphan = sales.find((s) => !covered.has(s.rep_id));
    if (orphan) {
      throw new ConflictException(
        `payroll backfill refused for run #${run.pay_period.period_number}: sale ${orphan.id} has no pay-run line for its rep`,
      );
    }

    const reps = plans.map((p) => p.summary);
    if (opts.dryRun) {
      return { ...base, outcome: 'would_write', reps };
    }

    // Same 120 s budget as finalize: one INSERT per sale, and Prisma's 5 s default expired mid-run on
    // production (38 sales over the pooler) — the tx rolled back cleanly, but wrote nothing.
    await this.prisma.$transaction(
      async (tx) => {
        for (const plan of plans) {
          await this.writePayrollLines(tx, run.id, plan.repSales, { items: plan.items }, dec(advancePct));
        }
      },
      { timeout: 120_000 },
    );
    await this.audit.log({
      actorId: opts.actorId,
      entityType: 'pay_runs',
      entityId: run.id,
      action: 'backfill_payroll_lines',
      after: { period_number: run.pay_period.period_number, reps },
    });
    return { ...base, outcome: 'written', reps };
  }

  /** Every finalized/exported run, oldest first — the operator script's work list. */
  async finalizedRunIds(): Promise<string[]> {
    const runs = await this.prisma.payRun.findMany({
      where: { status: { in: ['finalized', 'exported'] } },
      select: { id: true },
      orderBy: { pay_period: { start_date: 'asc' } },
    });
    return runs.map((r) => r.id);
  }

  /** The sales in this run that belong to ONE rep — the filter that scopes a statement. */
  private async saleIdsForRep(runId: string, repId: string): Promise<string[]> {
    const sales = await this.prisma.sale.findMany({
      where: { pay_run_id: runId, rep_id: repId },
      select: { id: true },
    });
    return sales.map((s) => s.id);
  }

  /** ADMIN: any rep's statement for a run. Gated by payrun:view at the controller. */
  async repPayStatement(runId: string, repId: string) {
    return this.buildRepStatement(runId, repId);
  }

  /**
   * SELF-SERVICE: the caller's OWN statement. Takes NO repId — the rep is resolved from the authenticated
   * user, so "someone else's statement" cannot be expressed by this endpoint at all. That is the whole
   * protection, and it is stronger than validating an id would be.
   *
   * A user with no linked rep is 403, not an empty 200: an empty list would imply "you have no statements"
   * when the truth is "you are not a rep".
   */
  async myPayStatement(runId: string, user: AuthUser) {
    if (!user.repId) {
      throw new ForbiddenException('Your account is not linked to a rep');
    }
    return this.buildRepStatement(runId, user.repId);
  }

  /** SELF-SERVICE: the finalized runs the caller has a statement for, newest first. */
  async myPayStatements(user: AuthUser) {
    if (!user.repId) {
      throw new ForbiddenException('Your account is not linked to a rep');
    }
    const sales = await this.prisma.sale.findMany({
      where: { rep_id: user.repId, pay_run_id: { not: null } },
      select: { pay_run_id: true },
      distinct: ['pay_run_id'],
    });
    const runIds = sales.map((s) => s.pay_run_id).filter((id): id is string => id !== null);
    const runs = await this.prisma.payRun.findMany({
      where: { id: { in: runIds } },
      include: { pay_period: true },
      orderBy: { run_date: 'desc' },
    });
    return runs.map((r) => ({
      pay_run_id: r.id,
      period_number: r.pay_period.period_number,
      period_start: iso(r.pay_period.start_date),
      period_end: iso(r.pay_period.end_date),
      run_status: r.status,
    }));
  }

  async exportRun(runId: string, dto: ExportPayRunDto, user: AuthUser) {
    const run = await this.prisma.payRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    if (run.status !== 'finalized' && run.status !== 'exported') {
      throw new ConflictException('only a finalized pay run can be exported');
    }
    // Scope the exported rows to the caller's reps — a manager exports only their roster, a rep only their
    // own; admin/SA (null) export all. Without this an export would leak every rep's pay. — CLAUDE §5 (PII)
    const repIds = await this.scopeRepIds(user);
    const lines = await this.prisma.payRunLine.findMany({
      where: { pay_run_id: runId, ...(repIds ? { rep_id: { in: repIds } } : {}) },
      include: { rep: { select: { rep_code: true, full_name: true } } },
      orderBy: { rep: { rep_code: 'asc' } },
    });
    const format = dto.format ?? 'csv';
    // Always 2 dp ("2019.50", never "2019.5"): Decimal#toString drops trailing zeros, and a payroll import
    // expects fixed cents. Values are stored at 2 dp, so toFixed(2) changes the TEXT only, never the amount.
    const cents = (v: { toFixed(dp: number): string }) => v.toFixed(2);
    // No holdback (2026-11-13): the commission column is the full amount paid. A released-holdback column is
    // included only for an OLD run that actually released one, so its net still adds up.
    const hasRelease = lines.some((l) => !l.holdback_release_30.isZero());
    const rows = lines.map((l) => ({
      rep_code: l.rep.rep_code,
      rep_name: l.rep.full_name,
      commission: cents(l.commission_70),
      ...(hasRelease ? { holdback_release: cents(l.holdback_release_30) } : {}),
      expense_total: cents(l.expense_total),
      incentive_total: cents(l.incentive_total),
      bonus_amount: cents(l.bonus_amount),
      clawback_total: cents(l.clawback_total),
      net_payout: cents(l.net_payout),
    }));
    const content = format === 'csv' ? this.toCsv(rows) : JSON.stringify(rows);

    if (run.status !== 'exported') {
      await this.prisma.payRun.update({ where: { id: runId }, data: { status: 'exported' } });
    }
    // No pay-run export table in the data model — the audit row IS the stored export record. (§12)
    await this.audit.log({
      actorId: user.id,
      entityType: 'pay_runs',
      entityId: runId,
      action: 'export',
      after: { format, line_count: rows.length },
    });
    return { pay_run_id: runId, format, line_count: rows.length, content };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────

  listRuns() {
    return this.prisma.payRun.findMany({
      include: { pay_period: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async getRun(runId: string, user: AuthUser) {
    const run = await this.prisma.payRun.findUnique({
      where: { id: runId },
      include: { pay_period: true },
    });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    const lines = await this.getLines(runId, user);
    return {
      ...run,
      // No holdback since 2026-11-13. True only for an OLD run whose frozen lines held or released some, so
      // the screens show those columns where the figures need them and nowhere else.
      has_holdback: lines.some((l) => nonZero(l.holdback_release_30) || nonZero(l.amount_held)),
      split: await this.config.getHoldbackSplit(iso(run.pay_period.end_date)),
      lines,
    };
  }

  async getLines(runId: string, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    const lines = await this.prisma.payRunLine.findMany({
      where: { pay_run_id: runId, ...(repIds ? { rep_id: { in: repIds } } : {}) },
      include: { rep: { select: { id: true, rep_code: true, full_name: true } } },
      orderBy: { rep: { rep_code: 'asc' } },
    });
    // Each rep's photo (HR headshot) on the line's rep. 2026-11-12
    const photos = this.avatars ? await this.avatars.resolveReps(lines.map((l) => l.rep_id)) : new Map<string, string | null>();
    return lines.map((l) => ({ ...l, rep: { ...l.rep, photo_url: photos.get(l.rep_id) ?? null } }));
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────

  /** Gather a rep's validated sales in the period and run the engine. Pure engine call (no DB writes). */
  private async gatherAndRun(
    tx: Prisma.TransactionClient,
    repId: string,
    period: PayPeriodRow,
    config: Awaited<ReturnType<CommissionConfigProvider['getEngineConfig']>>,
  ) {
    const sales = await tx.sale.findMany({
      where: {
        rep_id: repId,
        status: 'validated',
        sale_date: { gte: period.start_date, lte: period.end_date }, // sale_date governs (#7)
      },
      include: PAYROLL_SALE_INCLUDE,
    });
    const activations: ActivationInput[] = [];
    for (const sale of sales) {
      for (const item of sale.sale_items) {
        activations.push(
          toActivationInput({
            id: item.id,
            product_type: item.product_type,
            counts_toward_tally: item.counts_toward_tally,
            client_id: sale.client_id,
            sale_date: iso(sale.sale_date),
            // For the per-product RATE lookup only — the tally is untouched (#5).
            product_id: item.product_id,
          }),
        );
      }
    }
    return { result: this.engine.computePeriod({ activations, config }), sales };
  }

  /**
   * Freeze this rep's PAYROLL REPORT lines — Redwave's own workbook shape, one row per SALE.
   *
   * Written at finalize, in the same transaction, because that is the moment the snapshots freeze (#2/#8).
   * Every amount comes from the engine result already computed above — the same values being written onto
   * `sale_items` — so the report can never disagree with what was paid, and nothing is recomputed at
   * render time.
   *
   * #3: rep-pay stream only. No client billing rate is read here or anywhere downstream of it.
   * #9: greenfield gets its OWN column; it is flat-rated and out of the tally, so folding it into internet
   *     would misreport both.
   */
  private async writePayrollLines(
    tx: Prisma.TransactionClient,
    runId: string,
    sales: SalesForPayroll,
    result: { items: { id: string; productType: string; rateApplied: Decimal; incentiveAmount: Decimal }[] },
    advancePct: Decimal,
  ): Promise<void> {
    const byItemId = new Map(result.items.map((i) => [i.id, i]));

    const inputs: PayrollSaleInput[] = sales.map((sale) => {
      const components = {
        internet: new Decimal(0),
        tv: new Decimal(0),
        home_phone: new Decimal(0),
        greenfield: new Decimal(0),
        spiff: new Decimal(0),
        other: new Decimal(0),
      };
      let productName: string | null = null;
      let hasInternet = false;
      let hasTv = false;
      let hasHomePhone = false;

      for (const item of sale.sale_items) {
        const computed = byItemId.get(item.id);
        if (!computed) continue; // not part of this run's engine result
        // Classify EXACTLY as the engine did (mapToEngineProductType), so the column a line lands in and
        // the rate it was paid can never come from two different opinions of what the item is.
        const kind = mapToEngineProductType(item.product_type, item.counts_toward_tally);
        const amount = computed.rateApplied;
        if (kind === 'internet') {
          components.internet = components.internet.plus(amount);
          hasInternet = true;
          productName ??= item.product?.name ?? null;
        } else if (kind === 'greenfield_internet') {
          components.greenfield = components.greenfield.plus(amount);
          productName ??= item.product?.name ?? null;
        } else if (kind === 'tv') {
          components.tv = components.tv.plus(amount);
          hasTv = true;
        } else if (kind === 'home_phone') {
          components.home_phone = components.home_phone.plus(amount);
          hasHomePhone = true;
        } else {
          components.other = components.other.plus(amount);
        }
        components.spiff = components.spiff.plus(computed.incentiveAmount);
      }

      const address = [sale.street, sale.city, sale.province_state, sale.postal_code]
        .filter((part): part is string => !!part && part.trim().length > 0)
        .join(', ');

      return {
        sale_id: sale.id,
        sale_date: iso(sale.sale_date),
        rep_external_code: sale.rep?.external_code ?? null,
        rep_code: sale.rep?.rep_code ?? '',
        rep_name: sale.rep?.full_name ?? '',
        customer_name: sale.customer_name,
        address: address.length > 0 ? address : null,
        channel: sale.client?.client_code ?? '',
        product_name: productName,
        has_internet: hasInternet,
        has_tv: hasTv,
        has_home_phone: hasHomePhone,
        is_greenfield: sale.is_greenfield,
        components,
      };
    });

    const report = buildPayrollReport(inputs, advancePct);
    for (const line of report.lines) {
      await tx.payrollReportLine.create({
        data: {
          pay_run_id: runId,
          sale_id: line.sale_id,
          sort_order: line.sort_order,
          sale_date: new Date(`${line.sale_date}T00:00:00.000Z`),
          rep_external_code: line.rep_external_code,
          rep_code: line.rep_code,
          rep_name: line.rep_name,
          customer_name: line.customer_name,
          address: line.address,
          channel: line.channel,
          product_name: line.product_name,
          has_internet: line.has_internet,
          has_tv: line.has_tv,
          has_home_phone: line.has_home_phone,
          is_greenfield: line.is_greenfield,
          internet_rate: money(line.internet_rate),
          tv_rate: money(line.tv_rate),
          hp_rate: money(line.hp_rate),
          greenfield: money(line.greenfield),
          spiff: money(line.spiff),
          other_total: money(line.other_total),
          total_100: money(line.total_100),
          advance_70: money(line.advance_70),
          holdback_30: money(line.holdback_30),
        },
      });
    }
  }

  private lineData(
    runId: string,
    repId: string,
    amounts: ReturnType<typeof buildLineAmounts>,
    note: string | null,
  ): Prisma.PayRunLineUncheckedCreateInput {
    return {
      pay_run_id: runId,
      rep_id: repId,
      commission_70: money(amounts.commission_70),
      holdback_release_30: money(amounts.holdback_release_30),
      expense_total: money(amounts.expense_total),
      incentive_total: money(amounts.incentive_total),
      bonus_amount: money(amounts.bonus_amount),
      bonus_note: note,
      clawback_total: money(amounts.clawback_total),
      net_payout: money(amounts.net_payout),
      // Reconciliation facts straight off the engine result — never recomputed here (#1/#5). Persisting
      // gross + the 30% held is what lets the UI prove commission_70 = 70% of gross without any UI math.
      gross_commission: money(amounts.gross_commission),
      amount_held: money(amounts.amount_held),
      tier_at_payment: amounts.tier_at_payment,
      internet_tally: amounts.internet_tally,
      rate_per_activation: amounts.rate_per_activation ? money(amounts.rate_per_activation) : null,
    };
  }

  private async repsWithValidatedSales(
    period: PayPeriodRow,
    repIds: string[] | null,
  ): Promise<string[]> {
    const rows = await this.prisma.sale.findMany({
      where: {
        status: 'validated',
        sale_date: { gte: period.start_date, lte: period.end_date },
        ...(repIds ? { rep_id: { in: repIds } } : {}),
      },
      select: { rep_id: true },
      distinct: ['rep_id'],
    });
    return rows.map((r) => r.rep_id);
  }

  private async bonusesByRep(runId: string): Promise<Map<string, RepBonus>> {
    const lines = await this.prisma.payRunLine.findMany({
      where: { pay_run_id: runId },
      select: { rep_id: true, bonus_amount: true, bonus_note: true },
    });
    return new Map(
      lines.map((l) => [l.rep_id, { amount: dec(l.bonus_amount), note: l.bonus_note }]),
    );
  }

  private async scopeRepIds(user: AuthUser): Promise<string[] | null> {
    const scope = await this.scope.getRepScope(user);
    return scope.level === 'all' ? null : scope.repIds;
  }

  private toCsv(rows: Array<Record<string, string>>): string {
    if (rows.length === 0) {
      return '';
    }
    // RFC 4180 quoting: a value with a comma, quote or newline (e.g. a rep named "Lee, Jordan") is wrapped
    // in quotes with inner quotes doubled — otherwise it would shift every later column in the ADP file.
    const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const headers = Object.keys(rows[0]);
    const lines = [headers.map(field).join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => field(row[h])).join(','));
    }
    return lines.join('\n');
  }
}
