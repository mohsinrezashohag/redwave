/**
 * ExpensesService — weekly expense reports: submit, list, detail, edit (gated), and the
 * approval workflow. Owns expense_reports / expense_items / expense_km_logs / expense_km_stops.
 *
 * Money/distance are exact decimals, never float (#1). `week_start` governs the pay period the
 * report's APPROVED total is paid in — derived once at submit and stored (read by the Pay Run seam).
 * Approval is at the REPORT level; edit-rights are gated (pre-approval → expenses:edit; after
 * approval → Super Admin only). Meal eligibility is the approver's judgement, not auto-enforced.
 * — SRS §11 (EXP-001..008)
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CreateReportDto, ExpenseItemInput } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReviewDto, ReviewDecision } from './dto/review.dto';
import { ListReportsQuery } from './dto/list-reports.query';
import { computeKm, DEFAULT_RATE_PER_KM, TripType } from './km.logic';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const REPORT_INCLUDE = {
  expense_items: { include: { km_log: { include: { stops: { orderBy: { stop_order: 'asc' } } } } } },
} as const satisfies Prisma.ExpenseReportInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  // ── Submit ──────────────────────────────────────────────────────────────────────
  async submit(dto: CreateReportDto, user: AuthUser) {
    const repId = dto.rep_id ?? user.repId ?? null;
    const weekStart = dateOnly(dto.week_start);

    // `week_start` governs the pay period (#7). Derived once and stored; null if no period covers it.
    const period = await this.prisma.payPeriod.findFirst({
      where: { start_date: { lte: weekStart }, end_date: { gte: weekStart } },
      select: { id: true },
    });

    this.assertOneKmLogPerDay(dto.items);
    const configs = await this.loadConfigs();
    const itemCreates = dto.items.map((item) => this.buildItemCreate(item, configs));

    const report = await this.prisma.expenseReport.create({
      data: {
        submitted_by: user.id,
        rep_id: repId,
        week_start: weekStart,
        week_end: dateOnly(dto.week_end),
        status: 'submitted',
        pay_period_id: period?.id ?? null,
        expense_items: { create: itemCreates },
      },
      include: REPORT_INCLUDE,
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_reports',
      entityId: report.id,
      action: 'create',
      after: {
        rep_id: repId,
        week_start: dto.week_start,
        status: 'submitted',
        pay_period_id: report.pay_period_id,
        item_count: report.expense_items.length,
      },
    });
    // Best-effort: notify the approver — the rep's field manager, else Admins/Super Admins. — expense_submitted
    const base = {
      eventType: 'expense_submitted' as const,
      title: `New expense report from ${user.full_name}`,
      body: `An expense report for week ${dto.week_start} needs your review.`,
      relatedEntityType: 'expense_reports',
      relatedEntityId: report.id,
      variables: { submitter_name: user.full_name, week_start: dto.week_start },
    };
    const manager = repId
      ? await this.prisma.rep.findUnique({ where: { id: repId }, select: { field_manager_id: true } })
      : null;
    if (manager?.field_manager_id) {
      await this.emitter.emitMany([manager.field_manager_id], base);
    } else {
      await this.emitter.emitRole('Admin', base);
      await this.emitter.emitRole('Super Admin', base);
    }
    return report;
  }

  // ── List / detail ───────────────────────────────────────────────────────────────
  async list(query: ListReportsQuery, user: AuthUser) {
    const and: Prisma.ExpenseReportWhereInput[] = [await this.scopeWhere(user)];
    if (query.status) and.push({ status: query.status });
    if (query.rep_id) and.push({ rep_id: query.rep_id });
    if (query.pay_period_id) and.push({ pay_period_id: query.pay_period_id });
    if (query.client_id) and.push({ expense_items: { some: { client_id: query.client_id } } });
    if (query.from) and.push({ week_start: { gte: dateOnly(query.from) } });
    if (query.to) and.push({ week_start: { lte: dateOnly(query.to) } });

    return this.prisma.expenseReport.findMany({
      where: { AND: and },
      include: REPORT_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const report = await this.prisma.expenseReport.findFirst({
      where: { AND: [{ id }, await this.scopeWhere(user)] },
      include: REPORT_INCLUDE,
    });
    if (!report) {
      throw new NotFoundException('Expense report not found');
    }
    return report;
  }

  // ── Edit (gated) ──────────────────────────────────────────────────────────────────
  async edit(id: string, dto: UpdateReportDto, user: AuthUser) {
    const report = await this.findOne(id, user); // also enforces scope

    // Edit-rights gating (EXP-007): once approved, only a Super Admin may edit; otherwise the
    // controller's expenses:edit permission suffices.
    if (report.status === 'approved' && !user.isSuperAdmin) {
      await this.audit.log({
        actorId: user.id,
        entityType: 'expense_reports',
        entityId: id,
        action: 'access_denied',
        after: { reason: 'edit of an approved report requires Super Admin', status: report.status },
      });
      throw new ForbiddenException('an approved report can only be edited by a Super Admin');
    }

    if (dto.items) this.assertOneKmLogPerDay(dto.items);
    const configs = dto.items ? await this.loadConfigs() : null;
    const itemCreates = dto.items ? dto.items.map((i) => this.buildItemCreate(i, configs!)) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (itemCreates) {
        // Items replace the report's lines wholesale (km logs/stops re-derived).
        const existing = await tx.expenseItem.findMany({
          where: { expense_report_id: id },
          select: { id: true },
        });
        const itemIds = existing.map((i) => i.id);
        const logs = await tx.expenseKmLog.findMany({
          where: { expense_item_id: { in: itemIds } },
          select: { id: true },
        });
        const logIds = logs.map((l) => l.id);
        await tx.expenseKmStop.deleteMany({ where: { km_log_id: { in: logIds } } });
        await tx.expenseKmLog.deleteMany({ where: { id: { in: logIds } } });
        await tx.expenseItem.deleteMany({ where: { expense_report_id: id } });
        for (const itemData of itemCreates) {
          await tx.expenseItem.create({
            data: { ...itemData, expense_report: { connect: { id } } },
          });
        }
      }
      return tx.expenseReport.update({
        where: { id },
        data: {
          ...(dto.week_start ? { week_start: dateOnly(dto.week_start) } : {}),
          ...(dto.week_end ? { week_end: dateOnly(dto.week_end) } : {}),
        },
        include: REPORT_INCLUDE,
      });
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_reports',
      entityId: id,
      action: 'edit',
      before: { status: report.status, item_count: report.expense_items.length },
      after: { item_count: updated.expense_items.length },
    });
    return updated;
  }

  // ── Approval workflow ──────────────────────────────────────────────────────────────
  async review(id: string, dto: ReviewDto, user: AuthUser) {
    const report = await this.findOne(id, user);
    // Only a pending report (submitted or sent_back) can be acted on. — SRS §11 state machine
    if (report.status !== 'submitted' && report.status !== 'sent_back') {
      throw new UnprocessableEntityException(
        `cannot review a report in status '${report.status}'`,
      );
    }

    const nextStatus =
      dto.decision === ReviewDecision.approve
        ? 'approved'
        : dto.decision === ReviewDecision.reject
          ? 'rejected'
          : 'sent_back';

    const updated = await this.prisma.expenseReport.update({
      where: { id },
      data: {
        status: nextStatus,
        approved_by: dto.decision === ReviewDecision.approve ? user.id : null,
        approved_at: dto.decision === ReviewDecision.approve ? new Date() : null,
      },
      include: REPORT_INCLUDE,
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_reports',
      entityId: id,
      action: 'approve',
      before: { status: report.status },
      after: { status: nextStatus, decision: dto.decision, note: dto.note ?? null },
    });
    // Best-effort: notify the submitter of the decision. — expense_approved / _rejected / _sent_back
    const weekStart = updated.week_start.toISOString().slice(0, 10);
    const note = dto.note ?? '';
    const event =
      nextStatus === 'approved'
        ? { eventType: 'expense_approved', title: 'Expense report approved', body: `Your expense report for ${weekStart} was approved.` }
        : nextStatus === 'rejected'
          ? { eventType: 'expense_rejected', title: 'Expense report rejected', body: `Your expense report for ${weekStart} was rejected. ${note}` }
          : { eventType: 'expense_sent_back', title: 'Expense report needs changes', body: `Your expense report for ${weekStart} was sent back. ${note}` };
    await this.emitter.emitMany([updated.submitted_by], {
      ...event,
      relatedEntityType: 'expense_reports',
      relatedEntityId: id,
      variables: { week_start: weekStart, note, reviewer_name: user.full_name },
    });
    return updated;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────
  /** One mileage claim per day per report (EXP-004). Duplicate km dates → 422. */
  private assertOneKmLogPerDay(items: ExpenseItemInput[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      if (item.category !== ExpenseCategory.km) continue;
      if (seen.has(item.expense_date)) {
        throw new UnprocessableEntityException(
          `only one km log is allowed per day (duplicate ${item.expense_date})`,
        );
      }
      seen.add(item.expense_date);
    }
  }

  /** Build one ExpenseItem create payload, validating receipt/km rules. Throws 422 on violation. */
  private buildItemCreate(
    item: ExpenseItemInput,
    configs: Map<string, { requires_receipt: boolean; is_active: boolean }>,
  ): Prisma.ExpenseItemCreateWithoutExpense_reportInput {
    if (item.category === ExpenseCategory.km) {
      // km item: a km log is required; amount is COMPUTED (never trusted from the client). — EXP-004
      if (!item.km) {
        throw new UnprocessableEntityException('a km item requires a km log');
      }
      const tripType = item.km.trip_type as TripType;
      const { deductionKm, billableKm, computedAmount } = computeKm(
        new Decimal(item.km.total_km),
        tripType,
      );
      return {
        category: ExpenseCategory.km,
        ...(item.client_id ? { client: { connect: { id: item.client_id } } } : {}),
        expense_date: dateOnly(item.expense_date),
        amount: computedAmount.toFixed(2),
        description: item.description,
        receipt_url: null, // km never requires a receipt
        km_log: {
          create: {
            trip_type: item.km.trip_type,
            total_km: item.km.total_km,
            deduction_km: deductionKm.toString(),
            billable_km: billableKm.toString(),
            rate_per_km: DEFAULT_RATE_PER_KM.toString(),
            computed_amount: computedAmount.toFixed(2),
            stops: {
              create: item.km.stops.map((s) => ({
                stop_order: s.stop_order,
                address: s.address,
                lat: s.lat,
                lng: s.lng,
              })),
            },
          },
        },
      };
    }

    // non-km item: no km log; amount required; receipt mandatory per the category config.
    if (item.km) {
      throw new UnprocessableEntityException('a km log is only valid on a km item');
    }
    if (!item.amount) {
      throw new UnprocessableEntityException(`amount is required for a ${item.category} item`);
    }
    const config = configs.get(item.category);
    if (!config || !config.is_active) {
      throw new UnprocessableEntityException(`expense category '${item.category}' is not available`);
    }
    if (config.requires_receipt && !item.receipt_url) {
      throw new UnprocessableEntityException(`a receipt is required for a ${item.category} item`);
    }
    return {
      category: item.category,
      ...(item.client_id ? { client: { connect: { id: item.client_id } } } : {}),
      expense_date: dateOnly(item.expense_date),
      amount: item.amount,
      description: item.description,
      receipt_url: item.receipt_url ?? null,
    };
  }

  private async loadConfigs(): Promise<
    Map<string, { requires_receipt: boolean; is_active: boolean }>
  > {
    const rows = await this.prisma.expenseFieldConfig.findMany({
      select: { category_key: true, requires_receipt: true, is_active: true },
    });
    return new Map(rows.map((r) => [r.category_key, r]));
  }

  /** Scope fragment: own (submitted_by) or roster (rep_id) reports; Super Admin/Admin → all. — §5 */
  private async scopeWhere(user: AuthUser): Promise<Prisma.ExpenseReportWhereInput> {
    const scope = await this.scope.getRepScope(user);
    if (scope.level === 'all') {
      return {};
    }
    return { OR: [{ submitted_by: user.id }, { rep_id: { in: scope.repIds } }] };
  }
}
