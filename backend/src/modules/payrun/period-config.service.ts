/**
 * PeriodConfigService — the pay and billing CALENDARS as admin configuration.
 *
 * Reads/writes `period_configs` and regenerates FUTURE periods from them. The date arithmetic lives in the
 * pure `period-generation.logic.ts`; what lives here is the part that must touch the database to be safe:
 * deciding which periods may be written at all.
 *
 * FORWARD-ONLY, and this is the whole reason the feature is safe. A finalized pay run and an issued
 * statement or invoice are immutable and gapless-numbered (#2/#8). Moving a period boundary underneath one
 * does not throw — the numbers simply stop reconciling, quietly, and are found weeks later by someone
 * chasing a discrepancy. So regeneration refuses any period carrying a finalized run or an issued document
 * and returns a 422 NAMING it, rather than skipping silently or warning only in the UI.
 *
 * Periods are never deleted and re-created: existing rows are referenced by those same frozen documents.
 * — docs/claude-code/08-configurable-periods.md
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PeriodKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { selectEffectiveRate, toUtcDateOnly } from '../../common/effective-dating';
import { todayInWinnipeg } from '../../common/timezone';
import {
  GeneratedPeriod,
  PeriodShape,
  generatePeriods,
  overlappingBillingPeriods,
  periodNumberFor,
  validatePeriodShape,
} from './period-generation.logic';
import { SetPeriodConfigDto } from './dto/period-config.dto';

/** The genesis shapes — what the seed generated before any config row existed. */
const GENESIS: Record<PeriodKind, PeriodShape> = {
  pay: { anchorDate: '2026-01-04', lengthDays: 14, paydayOffsetDays: 13 },
  billing: { anchorDate: '2026-01-05', lengthDays: 7, paydayOffsetDays: null },
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`);

/** One period that regeneration refused to touch, and the document that froze it. */
export interface BlockedPeriod {
  period_number: number;
  start_date: string;
  end_date: string;
  reason: string;
}

@Injectable()
export class PeriodConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every config row for both calendars, newest first — the effective-dated history (#10). */
  async list() {
    const rows = await this.prisma.periodConfig.findMany({
      orderBy: [{ kind: 'asc' }, { effective_from: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      anchor_date: iso(r.anchor_date),
      length_days: r.length_days,
      payday_offset_days: r.payday_offset_days,
      effective_from: iso(r.effective_from),
      effective_to: r.effective_to ? iso(r.effective_to) : null,
      created_by: r.created_by,
    }));
  }

  /**
   * The shape in force for one calendar on a date — the configured row if there is one, else the GENESIS
   * shape the seed used. Falling back rather than throwing matters: the system worked before this table
   * existed and must keep working with it empty.
   */
  async shapeFor(kind: PeriodKind, on = todayInWinnipeg()): Promise<PeriodShape> {
    const rows = await this.prisma.periodConfig.findMany({ where: { kind } });
    const effective = selectEffectiveRate(rows, toUtcDateOnly(utc(on)));
    if (!effective) return GENESIS[kind];
    return {
      anchorDate: iso(effective.anchor_date),
      lengthDays: effective.length_days,
      paydayOffsetDays: effective.payday_offset_days,
    };
  }

  /**
   * Record a new calendar shape. Purely additive — it changes NOTHING on its own; periods move only when
   * an admin then regenerates. Keeping the two steps separate means the destructive-looking action is the
   * one that carries the guard, and a config row can be reviewed before anything is applied.
   */
  async set(dto: SetPeriodConfigDto, user: AuthUser) {
    const shape: PeriodShape = {
      anchorDate: dto.anchor_date,
      lengthDays: dto.length_days,
      paydayOffsetDays: dto.kind === 'pay' ? (dto.payday_offset_days ?? 0) : null,
    };
    const errors = validatePeriodShape(shape);
    // A billing week has no payday; accepting one would imply a bill pays a rep (§14 rule 1).
    if (dto.kind === 'billing' && dto.payday_offset_days !== undefined && dto.payday_offset_days !== null) {
      errors.push('payday_offset_days does not apply to a billing calendar — a bill has no payday');
    }
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: 'invalid period configuration', errors });
    }

    const created = await this.prisma.periodConfig.create({
      data: {
        kind: dto.kind,
        anchor_date: utc(dto.anchor_date),
        length_days: dto.length_days,
        payday_offset_days: shape.paydayOffsetDays,
        effective_from: utc(dto.effective_from),
        created_by: user.id,
      },
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'period_configs',
      entityId: created.id,
      action: 'create',
      after: {
        kind: dto.kind,
        anchor_date: dto.anchor_date,
        length_days: dto.length_days,
        payday_offset_days: shape.paydayOffsetDays,
      },
    });
    return { ...created, anchor_date: iso(created.anchor_date), effective_from: iso(created.effective_from) };
  }

  /**
   * PREVIEW a regeneration: what would change, and what is refused. Nothing is written. The preview and the
   * apply share `planRegeneration`, so what an admin is shown is exactly what would happen — a preview
   * computed by a separate path is a preview that can lie.
   */
  async previewRegeneration(kind: PeriodKind, count: number) {
    return this.planRegeneration(kind, count);
  }

  /**
   * APPLY a regeneration to FUTURE periods only. Refuses outright if any period in range is frozen: a
   * partial application would leave the calendar half-moved, which is harder to reason about than a
   * refusal. Existing rows are UPDATED in place, never deleted and re-created (#2 — frozen documents
   * reference them).
   */
  async regenerate(kind: PeriodKind, count: number, user: AuthUser) {
    const plan = await this.planRegeneration(kind, count);
    if (plan.blocked.length > 0) {
      throw new UnprocessableEntityException({
        message: 'cannot regenerate: some periods in range are frozen by a finalized run or issued document',
        blocked: plan.blocked,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const p of plan.periods) {
        if (kind === 'pay') {
          const data = {
            start_date: utc(p.start_date),
            end_date: utc(p.end_date),
            payday: utc(p.payday ?? p.end_date),
          };
          await tx.payPeriod.upsert({
            where: { period_number: p.period_number },
            update: data,
            create: { period_number: p.period_number, ...data, status: 'open' },
          });
        } else {
          const data = { start_date: utc(p.start_date), end_date: utc(p.end_date) };
          await tx.billingPeriod.upsert({
            where: { period_number: p.period_number },
            update: data,
            create: { period_number: p.period_number, ...data, status: 'open' },
          });
        }
      }
    });

    await this.audit.log({
      actorId: user.id,
      entityType: kind === 'pay' ? 'pay_periods' : 'billing_periods',
      entityId: String(plan.periods[0]?.period_number ?? kind),
      action: 'update',
      after: {
        regenerated: true,
        kind,
        from_period: plan.periods[0]?.period_number ?? null,
        count: plan.periods.length,
        shape: plan.shape,
      },
    });
    return { ...plan, applied: true };
  }

  /**
   * Work out which periods regeneration would touch and which are refused. Shared by preview and apply.
   *
   * The first period it will touch is the one containing TODAY — everything before that is history. Even
   * then each candidate is checked individually, because "in the past" and "frozen" are different facts: a
   * period can be finalized early, and a future period can already carry an issued statement.
   */
  private async planRegeneration(kind: PeriodKind, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      throw new UnprocessableEntityException('count must be between 1 and 200');
    }
    const today = todayInWinnipeg();
    const shape = await this.shapeFor(kind, today);
    const current = periodNumberFor(shape, today);
    // A future anchor means the whole calendar is ahead of us — start at 1.
    const from = current ?? 1;

    const periods = generatePeriods(shape, from, count);
    const blocked = await this.findBlocked(kind, periods);
    return {
      kind,
      shape: {
        anchor_date: shape.anchorDate,
        length_days: shape.lengthDays,
        payday_offset_days: shape.paydayOffsetDays ?? null,
      },
      from_period: from,
      periods,
      blocked,
    };
  }

  /**
   * The guard. A period is frozen when it carries a finalized pay run, or an issued statement/invoice.
   * The reason NAMES the document, because "period 7 is blocked" sends an admin hunting while "period 7
   * has finalized pay run …" does not.
   */
  private async findBlocked(kind: PeriodKind, periods: GeneratedPeriod[]): Promise<BlockedPeriod[]> {
    const numbers = periods.map((p) => p.period_number);
    const blocked: BlockedPeriod[] = [];
    const describe = (p: GeneratedPeriod, reason: string): BlockedPeriod => ({
      period_number: p.period_number,
      start_date: p.start_date,
      end_date: p.end_date,
      reason,
    });

    if (kind === 'pay') {
      const existing = await this.prisma.payPeriod.findMany({
        where: { period_number: { in: numbers } },
        select: { period_number: true, pay_runs: { select: { id: true, status: true } } },
      });
      for (const row of existing) {
        const frozen = row.pay_runs.find((r) => r.status !== 'draft');
        if (!frozen) continue;
        const p = periods.find((x) => x.period_number === row.period_number);
        if (p) blocked.push(describe(p, `pay run ${frozen.id} is ${frozen.status} for this period`));
      }
      // A statement keyed to a PAY period (legacy rows, before weekly billing) freezes it too.
      const docs = await this.prisma.clientStatement.findMany({
        where: { pay_period: { period_number: { in: numbers } }, status: 'issued' },
        select: { statement_number: true, pay_period: { select: { period_number: true } } },
      });
      for (const doc of docs) {
        const n = doc.pay_period?.period_number;
        const p = n === undefined || n === null ? undefined : periods.find((x) => x.period_number === n);
        if (p && !blocked.some((b) => b.period_number === p.period_number)) {
          blocked.push(describe(p, `statement #${doc.statement_number ?? '(legacy)'} is issued against this period`));
        }
      }
      return blocked;
    }

    const existing = await this.prisma.billingPeriod.findMany({
      where: { period_number: { in: numbers } },
      select: {
        period_number: true,
        client_statements: { where: { status: 'issued' }, select: { statement_number: true } },
        client_invoices: { where: { status: 'issued' }, select: { invoice_number: true } },
      },
    });
    for (const row of existing) {
      const stmt = row.client_statements[0];
      const inv = row.client_invoices[0];
      if (!stmt && !inv) continue;
      const p = periods.find((x) => x.period_number === row.period_number);
      if (!p) continue;
      blocked.push(
        describe(
          p,
          stmt
            ? `statement #${stmt.statement_number ?? '(legacy)'} is issued for this billing week`
            : `invoice #${inv?.invoice_number ?? '(legacy)'} is issued for this billing week`,
        ),
      );
    }
    return blocked;
  }

  /**
   * The billing-to-pay overlap for one pay period — the two-calendar boundary made visible (§14 rule 1). A
   * bill straddles two pay periods by design, and surfacing it here stops someone chasing a
   * reconciliation that was never going to tie out.
   */
  async calendarOverlap(payPeriodNumber: number) {
    const payShape = await this.shapeFor('pay');
    const billingShape = await this.shapeFor('billing');
    const exists = await this.prisma.payPeriod.findUnique({ where: { period_number: payPeriodNumber } });
    if (!exists) {
      throw new NotFoundException(`pay period ${payPeriodNumber} not found`);
    }
    return {
      pay_period_number: payPeriodNumber,
      pay_start: iso(exists.start_date),
      pay_end: iso(exists.end_date),
      billing_periods: overlappingBillingPeriods(payShape, billingShape, payPeriodNumber),
    };
  }
}
