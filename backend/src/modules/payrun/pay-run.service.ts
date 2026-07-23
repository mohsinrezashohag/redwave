/**
 * PayRunService — the orchestrator. COMPOSES the config provider + commission engine + sales; it
 * never reimplements tier/commission math (#5). Draft = preview (nothing frozen). Finalize = the
 * money action: ATOMIC + IDEMPOTENT (#8), freezes immutable snapshots (#2), transitions sales
 * Validated→In Pay Run→Paid (§16), records/releases holdback, applies bonuses, composes net.
 * — SRS §9 (PAY-001..011), arch §9
 *
 * Idempotency is STATE-BASED (pay_runs has no key column): re-finalizing a non-draft run is a no-op,
 * and freeze/holdback are further guarded (sales become Paid; one ledger row per rep+origin).
 * Money math uses decimal.js; conversion to Prisma Decimal (`.toFixed(2)`) happens only on write.
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HoldbackReleaseStatus, Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CommissionConfigProvider } from '../commission/commission-config.provider';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { ActivationInput } from '../engine/engine.types';
import { toActivationInput } from './activation-mapping.logic';
import { resolveScheduledReleasePeriod } from './holdback-release.logic';
import { buildLineAmounts, computeNet } from './line-amounts.logic';
import { EXPENSE_TOTAL_PROVIDER, ExpenseTotalProvider } from './seams/expense-total.provider';
import { CLAWBACK_TOTAL_PROVIDER, ClawbackTotalProvider } from './seams/clawback-total.provider';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { CreatePayRunDto } from './dto/create-pay-run.dto';
import { SetBonusDto } from './dto/bonus.dto';
import { ExportPayRunDto } from './dto/export.dto';
import { ListHoldbackQuery } from './dto/list-holdback.query';

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const dec = (value: { toString(): string }): Decimal => new Decimal(value.toString());
const money = (value: Decimal): string => value.toFixed(2);

type PayPeriodRow = { id: string; start_date: Date; end_date: Date; payday: Date };
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
          const released = await this.previewReleased(tx, repId, period.id);
          const bonus = existingBonuses.get(repId) ?? { amount: new Decimal(0), note: null };
          const amounts = buildLineAmounts(result, {
            released,
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
    const allPeriods = await this.prisma.payPeriod.findMany();
    const releaseSetting = await this.prisma.holdbackReleaseSetting.findFirst({
      orderBy: { effective_from: 'desc' },
    });
    const releaseRule = releaseSetting?.release_rule ?? 'next_cycle_after_30_days';

    // Collected during the tx; emitted AFTER it commits (best-effort, never inside the money tx).
    const notices: { repId: string; net: Decimal; released: Decimal }[] = [];

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

          // (b) Transition the rep's sales Validated → in_pay_run → paid (§16).
          const saleIds = sales.map((s) => s.id);
          if (saleIds.length > 0) {
            await tx.sale.updateMany({
              where: { id: { in: saleIds } },
              data: { status: 'in_pay_run', pay_run_id: run.id },
            });
            await tx.sale.updateMany({ where: { id: { in: saleIds } }, data: { status: 'paid' } });
          }

          // (c) Record this period's 30% holdback (freeze-once: one row per rep+origin).
          const existingHold = await tx.holdbackLedger.findFirst({
            where: { rep_id: repId, origin_pay_period_id: period.id },
          });
          if (!existingHold) {
            const scheduled = resolveScheduledReleasePeriod(period, allPeriods, releaseRule);
            await tx.holdbackLedger.create({
              data: {
                rep_id: repId,
                origin_pay_period_id: period.id,
                amount_held: money(result.holdbackAmount),
                scheduled_release_period_id: scheduled?.id ?? null,
                release_status: 'scheduled',
              },
            });
          }

          // (d) Release prior holds scheduled into THIS period, applying the rep's pending clawback as a
          // SET-OFF first: a clawback reduces a pending release (recorded as clawback_applied on the
          // ledger), and only the UNCOVERED remainder deducts from net — so the clawback is recovered
          // exactly once (net is unchanged; the books just show where it came from). — SRS §17.1
          const clawback = await this.clawbackSeam.getClawbackTotal(repId, period.id);
          const due = await tx.holdbackLedger.findMany({
            where: { rep_id: repId, scheduled_release_period_id: period.id, release_status: 'scheduled' },
          });
          const grossDue = due.reduce((s, h) => s.plus(dec(h.amount_held)), new Decimal(0));
          const setOff = Decimal.min(clawback, grossDue); // the clawback consumes the pending release first
          let remainingSetOff = setOff;
          let released = new Decimal(0); // net cash released to the rep after the set-off
          for (const hold of due) {
            const amount = dec(hold.amount_held);
            const holdSetOff = Decimal.min(remainingSetOff, amount);
            remainingSetOff = remainingSetOff.minus(holdSetOff);
            const paidOut = amount.minus(holdSetOff);
            released = released.plus(paidOut);
            await tx.holdbackLedger.update({
              where: { id: hold.id },
              data: {
                release_status: 'released',
                released_in_pay_run_id: run.id,
                amount_released: money(paidOut),
                clawback_applied: holdSetOff.isZero() ? null : money(holdSetOff),
              },
            });
          }
          const netClawback = clawback.minus(setOff); // the remainder deducts from net

          // (e/f) Compose net via the seams + bonus.
          const expense = await this.expenseSeam.getApprovedExpenseTotal(repId, period.id);
          const bonus = existingBonuses.get(repId) ?? { amount: new Decimal(0), note: null };
          const amounts = buildLineAmounts(result, {
            released,
            expense,
            bonus: bonus.amount,
            clawback: netClawback,
          });
          await tx.payRunLine.create({ data: this.lineData(run.id, repId, amounts, bonus.note) });
          notices.push({ repId, net: amounts.net_payout, released });

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

    // Best-effort, post-commit: notify each paid rep (and a holdback-release note where any released). — pay_run_finalized
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
      if (n.released.greaterThan(0)) {
        await this.emitter.emitMany([userId], {
          eventType: 'holdback_released',
          title: 'Holdback released',
          body: `${money(n.released)} of holdback was released in period ${periodNo}.`,
          relatedEntityType: 'pay_runs',
          relatedEntityId: run.id,
          variables: { amount: money(n.released), period_number: periodNo },
        });
      }
    }
    return this.getRun(runId, user);
  }

  // ── Export (ADP; status + audit record — no dedicated table) ──────────────────────────────────

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
    const rows = lines.map((l) => ({
      rep_code: l.rep.rep_code,
      rep_name: l.rep.full_name,
      commission_70: l.commission_70.toString(),
      holdback_release_30: l.holdback_release_30.toString(),
      expense_total: l.expense_total.toString(),
      incentive_total: l.incentive_total.toString(),
      bonus_amount: l.bonus_amount.toString(),
      clawback_total: l.clawback_total.toString(),
      net_payout: l.net_payout.toString(),
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
    return { ...run, lines: await this.getLines(runId, user) };
  }

  async getLines(runId: string, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    return this.prisma.payRunLine.findMany({
      where: { pay_run_id: runId, ...(repIds ? { rep_id: { in: repIds } } : {}) },
      include: { rep: { select: { id: true, rep_code: true, full_name: true } } },
      orderBy: { rep: { rep_code: 'asc' } },
    });
  }

  async listHoldbackLedger(query: ListHoldbackQuery, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    const and: Prisma.HoldbackLedgerWhereInput[] = [];
    if (repIds !== null) and.push({ rep_id: { in: repIds } });
    if (query.rep_id) and.push({ rep_id: query.rep_id });
    if (query.status) and.push({ release_status: query.status });
    return this.prisma.holdbackLedger.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: { origin_pay_period_id: 'asc' },
    });
  }

  /**
   * The run's period-level 30% (deferred pay) view — EVERY figure is computed here so the UI does no
   * arithmetic. DRAFT: the current hold + its release period are a PROJECTION (no ledger rows exist until
   * finalize) taken from the draft lines' `amount_held` and the same pure release rule finalize will apply.
   * FINALIZED: read from the frozen `holdback_ledger`. Rep-scoped via the run's (already scoped) lines.
   * — SRS §9 / §17.1
   */
  async getHoldbackSummary(runId: string, user: AuthUser) {
    const run = await this.prisma.payRun.findUnique({
      where: { id: runId },
      include: { pay_period: true },
    });
    if (!run) {
      throw new NotFoundException('Pay run not found');
    }
    const period = run.pay_period;
    const isProjection = run.status === 'draft';
    const lines = await this.getLines(runId, user); // already rep-scoped
    const repIds = lines.map((l) => l.rep_id);

    // Every ledger row for this run's reps — the single source for the figures below.
    const ledger = repIds.length
      ? await this.prisma.holdbackLedger.findMany({ where: { rep_id: { in: repIds } } })
      : [];
    const allPeriods = await this.prisma.payPeriod.findMany();
    const periodRef = (id: string | null) => {
      const p = id ? allPeriods.find((x) => x.id === id) : undefined;
      return p ? { id: p.id, period_number: p.period_number, payday: p.payday } : null;
    };
    const sum = (values: Decimal[]): Decimal => values.reduce((s, v) => s.plus(v), new Decimal(0));
    const opt = (value: { toString(): string } | null): Decimal => (value ? dec(value) : new Decimal(0));

    // (a) Held THIS period. Draft → the lines' projected 30%; finalized → the frozen ledger rows.
    const originRows = ledger.filter((r) => r.origin_pay_period_id === period.id);
    const held = isProjection
      ? sum(lines.map((l) => opt(l.amount_held)))
      : sum(originRows.map((r) => dec(r.amount_held)));

    // (b) WHEN it releases. Finalized → the frozen FK; draft → the pure rule (unchanged by this read).
    let releasePeriodId =
      originRows.find((r) => r.scheduled_release_period_id)?.scheduled_release_period_id ?? null;
    if (isProjection) {
      const setting = await this.prisma.holdbackReleaseSetting.findFirst({
        orderBy: { effective_from: 'desc' },
      });
      const rule = setting?.release_rule ?? 'next_cycle_after_30_days';
      releasePeriodId = resolveScheduledReleasePeriod(period, allPeriods, rule)?.id ?? null;
    }

    // (c) Prior holds maturing INTO this period (draft → still-scheduled amounts; finalized → released).
    const maturing = ledger.filter((r) => r.scheduled_release_period_id === period.id);
    const releasing = isProjection
      ? sum(maturing.filter((r) => r.release_status === 'scheduled').map((r) => dec(r.amount_held)))
      : sum(maturing.map((r) => opt(r.amount_released)));
    const setoff = sum(maturing.map((r) => opt(r.clawback_applied)));
    const outstanding = sum(
      ledger.filter((r) => r.release_status !== 'released').map((r) => dec(r.amount_held)),
    );

    // (d) Aggregate the ledger by ORIGIN period — "what is held, and when does it release".
    type Group = {
      held: Decimal;
      released: Decimal;
      setoff: Decimal;
      scheduledId: string | null;
      statuses: Set<HoldbackReleaseStatus>;
    };
    const groups = new Map<string, Group>();
    for (const row of ledger) {
      const g: Group = groups.get(row.origin_pay_period_id) ?? {
        held: new Decimal(0),
        released: new Decimal(0),
        setoff: new Decimal(0),
        scheduledId: null,
        statuses: new Set<HoldbackReleaseStatus>(),
      };
      g.held = g.held.plus(dec(row.amount_held));
      g.released = g.released.plus(opt(row.amount_released));
      g.setoff = g.setoff.plus(opt(row.clawback_applied));
      g.scheduledId = g.scheduledId ?? row.scheduled_release_period_id;
      g.statuses.add(row.release_status);
      groups.set(row.origin_pay_period_id, g);
    }
    const by_origin = [...groups.entries()]
      .map(([originId, g]) => ({
        origin_period: periodRef(originId),
        amount_held: money(g.held),
        scheduled_release_period: periodRef(g.scheduledId),
        // Mixed statuses across reps collapse to the least-advanced one (still owed wins).
        release_status: g.statuses.has('held')
          ? ('held' as const)
          : g.statuses.has('scheduled')
            ? ('scheduled' as const)
            : ('released' as const),
        amount_released: g.released.isZero() ? null : money(g.released),
        clawback_applied: g.setoff.isZero() ? null : money(g.setoff),
      }))
      .sort((a, b) => (a.origin_period?.period_number ?? 0) - (b.origin_period?.period_number ?? 0));

    return {
      is_projection: isProjection,
      held_this_period: money(held),
      held_release_period: periodRef(releasePeriodId),
      releasing_this_period: money(releasing),
      clawback_setoff_this_period: money(setoff),
      outstanding_total: money(outstanding),
      by_origin,
    };
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
      include: { sale_items: true },
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
          }),
        );
      }
    }
    return { result: this.engine.computePeriod({ activations, config }), sales };
  }

  private async previewReleased(
    tx: Prisma.TransactionClient,
    repId: string,
    periodId: string,
  ): Promise<Decimal> {
    const due = await tx.holdbackLedger.findMany({
      where: { rep_id: repId, scheduled_release_period_id: periodId, release_status: 'scheduled' },
      select: { amount_held: true },
    });
    return due.reduce((sum, h) => sum.plus(dec(h.amount_held)), new Decimal(0));
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
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => row[h]).join(','));
    }
    return lines.join('\n');
  }
}
