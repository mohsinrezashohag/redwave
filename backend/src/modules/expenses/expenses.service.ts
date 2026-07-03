/**
 * ExpensesService — ITEM-FIRST expenses: create one/several items, list (paginated + scoped), detail,
 * edit (gated), and the per-item approval workflow (single + bulk). Owns expense_items / expense_km_logs
 * / expense_km_stops. The legacy expense_reports table is retained only as optional grouping/history.
 *
 * The expense ITEM is the atomic unit (item-first): each carries its own submitter, status, approver,
 * and a pay_period DERIVED from its expense_date — so an approved item is paid in the cycle of its date
 * (same-cycle payout, EXP-009), read by the Pay Run seam. Money/distance are exact decimals, never float
 * (#1); the km amount is COMPUTED server-side (never trusted from the client). Approval is per ITEM;
 * edit-rights are gated (pre-approval → expenses:edit; after approval → Super Admin only, EXP-007). Meal
 * eligibility is the approver's judgement, not auto-enforced. — SRS §11 (EXP-001..011)
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
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { StorageService } from '../../common/storage/storage.service';
import { FilesService } from '../files/files.service';
import { MapsService } from './maps.service';
import { KmRateService } from './km-rate.service';
import { CreateExpenseItemsDto } from './dto/create-items.dto';
import { ExpenseItemInput } from './dto/expense-item.input';
import { UpdateExpenseItemDto } from './dto/update-item.dto';
import { ReviewDto, ReviewDecision } from './dto/review.dto';
import { BulkReviewDto } from './dto/bulk-review.dto';
import { ListExpenseItemsQuery } from './dto/list-items.query';
import { computeKm, TripType } from './km.logic';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Pre-stored_files receipt values: a long-lived signed URL or a `local://` fallback ref (Batch 5). */
const isLegacyReceiptRef = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://') || value.startsWith('local://');

const ITEM_INCLUDE = {
  km_log: { include: { stops: { orderBy: { stop_order: 'asc' } } } },
} as const satisfies Prisma.ExpenseItemInclude;

/** Sortable columns for the item list (the orderBy-injection allowlist). */
const SORTABLE = ['expense_date', 'amount', 'status', 'category', 'created_at'] as const;

/** The content (non-lifecycle) of one item, ready to write. km_log is nested-created for km items. */
interface ItemContent {
  category: ExpenseCategory;
  client_id: string | null;
  expense_date: Date;
  amount: string;
  is_personal: boolean;
  tags: string[];
  description: string;
  receipt_url: string | null;
  pay_period_id: string | null;
  km_log?: { create: Prisma.ExpenseKmLogUncheckedCreateWithoutExpense_itemInput };
}

type ConfigMap = Map<string, { requires_receipt: boolean; is_active: boolean }>;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly maps: MapsService,
    private readonly kmRates: KmRateService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  // ── Create (one or several items) ─────────────────────────────────────────────────
  async createItems(dto: CreateExpenseItemsDto, user: AuthUser) {
    const repId = dto.rep_id ?? user.repId ?? null;
    const configs = await this.loadConfigs();

    // KM dedup: one km item per (rep, expense_date) — within the batch and against existing items.
    this.assertNoDupKmWithinBatch(dto.items);
    await this.assertNoExistingKmForDays(repId, dto.items);

    // Resolve each item's pay period from ITS OWN expense_date (EXP-009), cached per distinct date.
    const periodCache = new Map<string, string | null>();
    const contents: ItemContent[] = [];
    for (const item of dto.items) {
      const payPeriodId = await this.resolvePayPeriodId(item.expense_date, periodCache);
      contents.push(await this.buildItemContent(item, configs, payPeriodId, user));
    }

    const created = await this.prisma.$transaction((tx) =>
      Promise.all(
        contents.map((content) =>
          tx.expenseItem.create({
            data: { ...content, submitted_by: user.id, rep_id: repId, status: 'submitted' },
            include: ITEM_INCLUDE,
          }),
        ),
      ),
    );

    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_items',
      entityId: created[0].id,
      action: 'create',
      after: {
        rep_id: repId,
        status: 'submitted',
        item_ids: created.map((i) => i.id),
        count: created.length,
      },
    });

    // Best-effort: notify the approver — the rep's field manager, else Admins/Super Admins. — expense_submitted
    const base = {
      eventType: 'expense_submitted' as const,
      title: `New expense items from ${user.full_name}`,
      body: `${created.length} expense item(s) need your review.`,
      relatedEntityType: 'expense_items',
      relatedEntityId: created[0].id,
      variables: { submitter_name: user.full_name, count: String(created.length) },
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
    return created;
  }

  // ── List / detail ───────────────────────────────────────────────────────────────
  async list(query: ListExpenseItemsQuery, user: AuthUser) {
    const and: Prisma.ExpenseItemWhereInput[] = [await this.scopeWhere(user)];
    if (query.status) and.push({ status: query.status });
    if (query.category) and.push({ category: query.category });
    if (query.rep_id) and.push({ rep_id: query.rep_id });
    if (query.client_id) and.push({ client_id: query.client_id });
    if (query.pay_period_id) and.push({ pay_period_id: query.pay_period_id });
    if (query.from) and.push({ expense_date: { gte: dateOnly(query.from) } });
    if (query.to) and.push({ expense_date: { lte: dateOnly(query.to) } });
    if (query.search) and.push({ description: { contains: query.search, mode: 'insensitive' } });

    const where: Prisma.ExpenseItemWhereInput = { AND: and };
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, SORTABLE, { expense_date: 'desc' });
    const [data, total] = await Promise.all([
      this.prisma.expenseItem.findMany({ where, include: ITEM_INCLUDE, orderBy, skip, take }),
      this.prisma.expenseItem.count({ where }),
    ]);
    return buildPage(data, total, page, limit);
  }

  async findOne(id: string, user: AuthUser) {
    const item = await this.prisma.expenseItem.findFirst({
      where: { AND: [{ id }, await this.scopeWhere(user)] },
      include: ITEM_INCLUDE,
    });
    if (!item) {
      throw new NotFoundException('Expense item not found');
    }
    return item;
  }

  /**
   * Access-controlled receipt URL: the SAME item visibility as the detail GET (scoped in the query), then
   * a fresh 60s signed URL for the stored path. Legacy values (pre-stored_files long-lived URLs) pass
   * through as-is; `local://` fallback refs are not servable. Issuance is audited (who/path/when).
   */
  async receiptUrl(id: string, user: AuthUser): Promise<{ url: string }> {
    const item = await this.findOne(id, user); // 404 if not visible — no leak
    if (!item.receipt_url) {
      throw new NotFoundException('this item has no receipt');
    }
    let url: string;
    if (item.receipt_url.startsWith('http://') || item.receipt_url.startsWith('https://')) {
      url = item.receipt_url; // legacy stored signed URL (Batch 5) — served as recorded
    } else if (item.receipt_url.startsWith('local://')) {
      throw new NotFoundException('the receipt file is not available (storage was not configured at upload time)');
    } else {
      this.storage.assertConfigured(); // 503 — a stored path needs storage to sign
      const signed = await this.storage.signedUrl(item.receipt_url, 60);
      if (!signed) {
        throw new NotFoundException('the receipt file is not available');
      }
      url = signed;
    }
    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_items',
      entityId: item.id,
      action: 'download',
      after: { path: item.receipt_url },
    });
    return { url };
  }

  // ── Edit (gated, EXP-007) ──────────────────────────────────────────────────────────
  async editItem(id: string, dto: UpdateExpenseItemDto, user: AuthUser) {
    const item = await this.findOne(id, user); // also enforces scope

    // Once approved, only a Super Admin may edit; otherwise the controller's expenses:edit suffices.
    if (item.status === 'approved' && !user.isSuperAdmin) {
      await this.audit.log({
        actorId: user.id,
        entityType: 'expense_items',
        entityId: id,
        action: 'access_denied',
        after: { reason: 'edit of an approved item requires Super Admin', status: item.status },
      });
      throw new ForbiddenException('an approved expense item can only be edited by a Super Admin');
    }

    const configs = await this.loadConfigs();
    if (dto.category === ExpenseCategory.km) {
      await this.assertNoExistingKmForDays(item.rep_id, [dto], id);
    }
    const periodCache = new Map<string, string | null>();
    const payPeriodId = await this.resolvePayPeriodId(dto.expense_date, periodCache);
    const content = await this.buildItemContent(dto, configs, payPeriodId, user);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-derive the km log/stops wholesale (delete old, create new) so an edit can switch category.
      const oldLog = await tx.expenseKmLog.findUnique({
        where: { expense_item_id: id },
        select: { id: true },
      });
      if (oldLog) {
        await tx.expenseKmStop.deleteMany({ where: { km_log_id: oldLog.id } });
        await tx.expenseKmLog.delete({ where: { id: oldLog.id } });
      }
      return tx.expenseItem.update({
        where: { id },
        data: {
          category: content.category,
          client_id: content.client_id,
          expense_date: content.expense_date,
          amount: content.amount,
          is_personal: content.is_personal,
          tags: content.tags,
          description: content.description,
          receipt_url: content.receipt_url,
          pay_period_id: content.pay_period_id,
          ...(content.km_log ? { km_log: content.km_log } : {}),
        },
        include: ITEM_INCLUDE,
      });
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_items',
      entityId: id,
      action: 'edit',
      before: { status: item.status, category: item.category, amount: item.amount.toString() },
      after: { category: updated.category, amount: updated.amount.toString() },
    });
    return updated;
  }

  // ── Delete (draft/sent_back, own) ─────────────────────────────────────────────────
  async deleteItem(id: string, user: AuthUser) {
    const item = await this.findOne(id, user);
    // Only a not-yet-approved item may be removed; approved items are preserved (ledger). — EXP-007
    if (item.status === 'approved') {
      throw new UnprocessableEntityException('an approved expense item cannot be deleted');
    }
    await this.prisma.$transaction(async (tx) => {
      const log = await tx.expenseKmLog.findUnique({ where: { expense_item_id: id }, select: { id: true } });
      if (log) {
        await tx.expenseKmStop.deleteMany({ where: { km_log_id: log.id } });
        await tx.expenseKmLog.delete({ where: { id: log.id } });
      }
      await tx.expenseItem.delete({ where: { id } });
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_items',
      entityId: id,
      action: 'delete',
      before: { status: item.status, category: item.category },
    });
    return { id, deleted: true };
  }

  // ── Approval workflow (single) ─────────────────────────────────────────────────────
  async review(id: string, dto: ReviewDto, user: AuthUser) {
    const item = await this.findOne(id, user);
    const updated = await this.transitionOne(item, dto.decision, dto.note ?? null, user);
    if (!updated) {
      throw new UnprocessableEntityException(`cannot review an item in status '${item.status}'`);
    }
    return updated;
  }

  // ── Approval workflow (bulk) ───────────────────────────────────────────────────────
  async bulkReview(dto: BulkReviewDto, user: AuthUser) {
    const scopeWhere = await this.scopeWhere(user);
    const items = await this.prisma.expenseItem.findMany({
      where: { AND: [{ id: { in: dto.ids } }, scopeWhere] },
      include: ITEM_INCLUDE,
    });
    let reviewed = 0;
    for (const item of items) {
      const updated = await this.transitionOne(item, dto.decision, dto.note ?? null, user);
      if (updated) reviewed += 1;
    }
    return { reviewed, skipped: dto.ids.length - reviewed };
  }

  /**
   * Transition one item per the decision. Returns the updated row, or null when the item is not in a
   * reviewable status (submitted | sent_back) so the caller can skip/raise. Sets approved_by/at on
   * approve; clears them on reject/send_back. — SRS §11 state machine
   */
  private async transitionOne(
    item: { id: string; status: string; submitted_by: string; expense_date: Date; pay_period_id: string | null },
    decision: ReviewDecision,
    note: string | null,
    user: AuthUser,
  ) {
    if (item.status !== 'submitted' && item.status !== 'sent_back') {
      return null;
    }
    const nextStatus =
      decision === ReviewDecision.approve
        ? 'approved'
        : decision === ReviewDecision.reject
          ? 'rejected'
          : 'sent_back';

    const updated = await this.prisma.expenseItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        approved_by: decision === ReviewDecision.approve ? user.id : null,
        approved_at: decision === ReviewDecision.approve ? new Date() : null,
      },
      include: ITEM_INCLUDE,
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_items',
      entityId: item.id,
      action: 'approve',
      before: { status: item.status },
      after: { status: nextStatus, decision, note },
    });

    // Best-effort: notify the submitter of the decision. — expense_approved / _rejected / _sent_back
    const when = isoDate(item.expense_date);
    const event =
      nextStatus === 'approved'
        ? { eventType: 'expense_approved', title: 'Expense item approved', body: `Your expense item for ${when} was approved.` }
        : nextStatus === 'rejected'
          ? { eventType: 'expense_rejected', title: 'Expense item rejected', body: `Your expense item for ${when} was rejected. ${note ?? ''}` }
          : { eventType: 'expense_sent_back', title: 'Expense item needs changes', body: `Your expense item for ${when} was sent back. ${note ?? ''}` };
    await this.emitter.emitMany([item.submitted_by], {
      ...event,
      relatedEntityType: 'expense_items',
      relatedEntityId: item.id,
      variables: { expense_date: when, note: note ?? '', reviewer_name: user.full_name },
    });
    return updated;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────
  /** Within one batch: one mileage claim per day (duplicate km dates → 422). — EXP-004 */
  private assertNoDupKmWithinBatch(items: ExpenseItemInput[]): void {
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

  /** Against existing items: one km item per (rep, expense_date), ignoring rejected items. — EXP-004 */
  private async assertNoExistingKmForDays(
    repId: string | null,
    items: ExpenseItemInput[],
    excludeItemId?: string,
  ): Promise<void> {
    const kmDates = items.filter((i) => i.category === ExpenseCategory.km).map((i) => dateOnly(i.expense_date));
    if (kmDates.length === 0) return;
    const clash = await this.prisma.expenseItem.findFirst({
      where: {
        category: ExpenseCategory.km,
        rep_id: repId,
        expense_date: { in: kmDates },
        status: { not: 'rejected' },
        ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
      },
      select: { expense_date: true },
    });
    if (clash) {
      throw new UnprocessableEntityException(
        `a km log already exists for ${isoDate(clash.expense_date)} (one per day per rep)`,
      );
    }
  }

  /** Build one item's CONTENT (validates receipt/km rules); throws 422 on violation. — EXP-002..004 */
  private async buildItemContent(
    item: ExpenseItemInput,
    configs: ConfigMap,
    payPeriodId: string | null,
    user: AuthUser,
  ): Promise<ItemContent> {
    if (item.category === ExpenseCategory.km) {
      // km item: a km log is required; amount is COMPUTED (never trusted from the client). — EXP-004
      if (!item.km) {
        throw new UnprocessableEntityException('a km item requires a km log');
      }
      const tripType = item.km.trip_type as TripType;
      // Distance is AUTHORITATIVE server-side: re-derive from the stops via Maps when configured,
      // else fall back to the client total_km (no-geocoder mode). The amount is always computed here.
      // A ROUND trip measures the closed loop (return to the first stop appended automatically);
      // the −30/−60 deduction itself is unchanged (km.logic). — BRD §6.3 / SRS EXP-004
      const routeKm = await this.maps.routeDistanceKm(item.km.stops, { roundTrip: tripType === 'round' });
      const totalKm = routeKm ?? new Decimal(item.km.total_km);
      // Per-client, effective-dated REP reimbursement rate for the item's date (client-specific → global
      // → the $0.45 default). Two-stream (#3); the amount is always computed server-side (#1). — EXP-004
      const ratePerKm = await this.kmRates.resolveRepRate(item.client_id ?? null, dateOnly(item.expense_date));
      const { deductionKm, billableKm, computedAmount } = computeKm(totalKm, tripType, ratePerKm);
      return {
        category: ExpenseCategory.km,
        client_id: item.client_id ?? null,
        expense_date: dateOnly(item.expense_date),
        amount: computedAmount.toFixed(2),
        is_personal: item.is_personal ?? false,
        tags: item.tags ?? [],
        description: item.description,
        receipt_url: null, // km never requires a receipt
        pay_period_id: payPeriodId,
        km_log: {
          create: {
            trip_type: item.km.trip_type,
            total_km: totalKm.toFixed(2), // the server-derived (or fallback) authoritative distance
            deduction_km: deductionKm.toString(),
            billable_km: billableKm.toString(),
            rate_per_km: ratePerKm.toString(),
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
    // CLAIM the receipt path: must exist in stored_files AND be the caller's own upload (Admin/SA exempt)
    // — an unknown/foreign reference is rejected (422). Legacy values (full URLs from the pre-stored_files
    // pipeline, or local:// fallback refs) pass through unchanged so existing items stay editable.
    // — security.md (file storage, claim validation)
    if (item.receipt_url && !isLegacyReceiptRef(item.receipt_url)) {
      await this.files.claim(item.receipt_url, user, 'receipt');
    }
    return {
      category: item.category,
      client_id: item.client_id ?? null,
      expense_date: dateOnly(item.expense_date),
      amount: item.amount,
      is_personal: item.is_personal ?? false,
      tags: item.tags ?? [],
      description: item.description,
      receipt_url: item.receipt_url ?? null,
      pay_period_id: payPeriodId,
    };
  }

  /** Resolve the pay period whose [start,end] contains the item's expense_date (#7/EXP-009). */
  private async resolvePayPeriodId(date: string, cache: Map<string, string | null>): Promise<string | null> {
    if (cache.has(date)) return cache.get(date) ?? null;
    const period = await this.prisma.payPeriod.findFirst({
      where: { start_date: { lte: dateOnly(date) }, end_date: { gte: dateOnly(date) } },
      select: { id: true },
    });
    const id = period?.id ?? null;
    cache.set(date, id);
    return id;
  }

  private async loadConfigs(): Promise<ConfigMap> {
    const rows = await this.prisma.expenseFieldConfig.findMany({
      select: { category_key: true, requires_receipt: true, is_active: true },
    });
    return new Map(rows.map((r) => [r.category_key, r]));
  }

  /** Scope fragment: own (submitted_by) or roster (rep_id) items; Super Admin/Admin → all. — §5 */
  private async scopeWhere(user: AuthUser): Promise<Prisma.ExpenseItemWhereInput> {
    const scope = await this.scope.getRepScope(user);
    if (scope.level === 'all') {
      return {};
    }
    return { OR: [{ submitted_by: user.id }, { rep_id: { in: scope.repIds } }] };
  }
}
