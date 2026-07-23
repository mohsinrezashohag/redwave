/**
 * ExpenseReportsService — the report FOLDER (report-as-folder, EXP-001). A rep creates + names a folder and
 * adds items into it; the whole folder is submitted + reviewed as a unit. The folder has NO stored approval
 * state — its `status` is the DERIVED aggregate of its items (folder-status.logic), and `total`/`validation`
 * are computed on read. Money reads elsewhere are unchanged (item-level status/period/amount_cad); the folder
 * is a pure grouping layer (#1/#12 untouched). Owns expense_reports; reuses ExpensesService for item ops.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { ConfigMap, ExpensesService, ItemForValidation } from './expenses.service';
import { deriveFolderStatus } from './folder-status.logic';
import { CreateExpenseReportDto, ListExpenseReportsQuery, ReviewReportDto, UpdateExpenseReportDto } from './dto/expense-report.dto';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/** The full item shape used for a folder-detail response (with km log + stops) + validation inputs. */
const ITEM_INCLUDE = {
  km_log: { include: { stops: { orderBy: { stop_order: 'asc' as const } } } },
} as const;

/** Lean item projection for the folder-LIST aggregate (status/total/validation only). */
const ITEM_AGG_SELECT = {
  status: true,
  is_personal: true,
  amount_cad: true,
  category: true,
  amount: true,
  receipt_url: true,
  field_values: true,
  km_log: { select: { billable_km: true } },
} as const;

const SORTABLE = ['name', 'week_start', 'created_at'] as const;

type AggItem = { status: string; is_personal: boolean; amount_cad: Prisma.Decimal | null } & ItemForValidation;

@Injectable()
export class ExpenseReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly expenses: ExpensesService,
    private readonly audit: AuditService,
  ) {}

  /** Folders the caller may SEE: own (submitted_by) or roster (rep_id); Admin/SA → all. — §5 */
  private async scopeWhere(user: AuthUser): Promise<Prisma.ExpenseReportWhereInput> {
    const scope = await this.scope.getRepScope(user);
    if (scope.level === 'all') return {};
    return { OR: [{ submitted_by: user.id }, { rep_id: { in: scope.repIds } }] };
  }

  /** Compute a folder's derived status + reimbursable total + aggregated validation from its items. */
  private summarize(items: AggItem[], configs: ConfigMap) {
    let total = new Decimal(0);
    let alert_count = 0;
    let warning_count = 0;
    let flagged = 0;
    for (const item of items) {
      if (!item.is_personal && item.amount_cad) total = total.plus(new Decimal(item.amount_cad.toString()));
      const v = this.expenses.itemValidation(item, configs);
      alert_count += v.alert_count;
      warning_count += v.warning_count;
      if (v.alert_count + v.warning_count > 0) flagged += 1;
    }
    return {
      item_count: items.length,
      total_reimbursable_cad: total.toFixed(2),
      status: deriveFolderStatus(items.map((i) => i.status)),
      validation: { alert_count, warning_count, flagged },
    };
  }

  // ── Create ──────────────────────────────────────────────────────────────────────
  /**
   * Create the rep's folder for a week — or RESOLVE to the one they already have. A week is a single
   * container by design, so a second "new report" for the same (rep, week) is the rep looking for the
   * folder they already made, not asking for a duplicate: splitting a week across two folders is how items
   * get submitted twice or missed entirely at review. Returns the existing folder with its live aggregates
   * (`reused: true`) so the caller can say so instead of silently pretending it created one. — EXP-001
   *
   * Only a folder OWNED by the same submitter for the same rep+week resolves; another user's folder for
   * that rep is left alone (an admin creating on behalf still gets their own container).
   */
  async create(dto: CreateExpenseReportDto, user: AuthUser) {
    const repId = dto.rep_id ?? user.repId ?? null;
    const weekStart = dateOnly(dto.week_start);

    const existing = await this.prisma.expenseReport.findFirst({
      where: { submitted_by: user.id, rep_id: repId, week_start: weekStart },
      orderBy: { created_at: 'asc' }, // the ORIGINAL folder for the week, not the newest duplicate
    });
    if (existing) {
      const items = await this.prisma.expenseItem.findMany({
        where: { expense_report_id: existing.id },
        select: ITEM_AGG_SELECT,
      });
      const configs = await this.expenses.loadConfigs();
      return { ...existing, ...this.summarize(items, configs), reused: true };
    }

    const report = await this.prisma.expenseReport.create({
      data: {
        name: dto.name,
        submitted_by: user.id,
        rep_id: repId,
        week_start: weekStart,
        week_end: dateOnly(dto.week_end),
      },
    });
    await this.audit.log({ actorId: user.id, entityType: 'expense_reports', entityId: report.id, action: 'create', after: { name: report.name } });
    // A fresh folder is empty → derived status 'empty', zero totals.
    return {
      ...report,
      item_count: 0,
      total_reimbursable_cad: '0.00',
      status: 'empty' as const,
      validation: { alert_count: 0, warning_count: 0, flagged: 0 },
      reused: false,
    };
  }

  // ── List (paginated + scoped, aggregated) ─────────────────────────────────────────
  async list(query: ListExpenseReportsQuery, user: AuthUser) {
    const and: Prisma.ExpenseReportWhereInput[] = [await this.scopeWhere(user)];
    if (query.rep_id) and.push({ rep_id: query.rep_id });
    if (query.search) and.push({ name: { contains: query.search, mode: 'insensitive' } });
    // The approval queue: folders with ≥1 item awaiting review (submitted). — EXP-006
    if (query.awaiting_review === 'true') and.push({ expense_items: { some: { status: 'submitted' } } });
    const where: Prisma.ExpenseReportWhereInput = { AND: and };

    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, SORTABLE, { created_at: 'desc' });
    const [folders, total, configs] = await Promise.all([
      this.prisma.expenseReport.findMany({ where, orderBy, skip, take }),
      this.prisma.expenseReport.count({ where }),
      this.expenses.loadConfigs(),
    ]);

    // One query for all page items → group by folder → summarize.
    const items = await this.prisma.expenseItem.findMany({
      where: { expense_report_id: { in: folders.map((f) => f.id) } },
      select: { expense_report_id: true, ...ITEM_AGG_SELECT },
    });
    const byReport = new Map<string, AggItem[]>();
    for (const item of items) {
      const bucket = byReport.get(item.expense_report_id) ?? [];
      bucket.push(item);
      byReport.set(item.expense_report_id, bucket);
    }
    const data = folders.map((f) => ({ ...f, ...this.summarize(byReport.get(f.id) ?? [], configs) }));
    return buildPage(data, total, page, limit);
  }

  // ── Detail (folder + its items with per-item validation) ─────────────────────────
  async findOne(id: string, user: AuthUser) {
    const report = await this.prisma.expenseReport.findFirst({ where: { AND: [{ id }, await this.scopeWhere(user)] } });
    if (!report) {
      throw new NotFoundException('Expense report not found');
    }
    const [items, configs] = await Promise.all([
      this.prisma.expenseItem.findMany({ where: { expense_report_id: id }, include: ITEM_INCLUDE, orderBy: { expense_date: 'asc' } }),
      this.expenses.loadConfigs(),
    ]);
    const summary = this.summarize(items as unknown as AggItem[], configs);
    return {
      ...report,
      ...summary,
      items: items.map((item) => ({ ...item, validation: this.expenses.itemValidation(item, configs) })),
    };
  }

  // ── Rename / adjust week ──────────────────────────────────────────────────────────
  async update(id: string, dto: UpdateExpenseReportDto, user: AuthUser) {
    await this.expenses.assertManageableReport(id, user);
    await this.prisma.expenseReport.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.week_start !== undefined ? { week_start: dateOnly(dto.week_start) } : {}),
        ...(dto.week_end !== undefined ? { week_end: dateOnly(dto.week_end) } : {}),
      },
    });
    await this.audit.log({ actorId: user.id, entityType: 'expense_reports', entityId: id, action: 'edit', after: { name: dto.name } });
    return this.findOne(id, user);
  }

  // ── Delete (cascade unapproved; 422 if any approved) ─────────────────────────────
  async remove(id: string, user: AuthUser) {
    await this.expenses.assertManageableReport(id, user);
    const items = await this.prisma.expenseItem.findMany({ where: { expense_report_id: id }, select: { id: true, status: true } });
    if (items.some((i) => i.status === 'approved')) {
      throw new UnprocessableEntityException('this folder has an approved item and cannot be deleted');
    }
    const itemIds = items.map((i) => i.id);
    await this.prisma.$transaction(async (tx) => {
      if (itemIds.length > 0) {
        const logs = await tx.expenseKmLog.findMany({ where: { expense_item_id: { in: itemIds } }, select: { id: true } });
        const logIds = logs.map((l) => l.id);
        if (logIds.length > 0) {
          await tx.expenseKmStop.deleteMany({ where: { km_log_id: { in: logIds } } });
          await tx.expenseKmLog.deleteMany({ where: { id: { in: logIds } } });
        }
        await tx.expenseItem.deleteMany({ where: { id: { in: itemIds } } });
      }
      await tx.expenseReport.delete({ where: { id } });
    });
    await this.audit.log({ actorId: user.id, entityType: 'expense_reports', entityId: id, action: 'delete', before: { item_count: items.length } });
    return { id, deleted: true };
  }

  // ── Submit (draft|sent_back items → submitted) ────────────────────────────────────
  async submit(id: string, user: AuthUser) {
    const moved = await this.expenses.submitReportItems(id, user);
    if (moved === 0) {
      throw new UnprocessableEntityException('this folder has no items to submit');
    }
    return this.findOne(id, user);
  }

  // ── Review (bulk decision over the folder's reviewable items) ─────────────────────
  async review(id: string, dto: ReviewReportDto, user: AuthUser) {
    // The folder must be visible to the reviewer (scope), then bulk-review its submitted|sent_back items.
    const report = await this.prisma.expenseReport.findFirst({ where: { AND: [{ id }, await this.scopeWhere(user)] }, select: { id: true } });
    if (!report) {
      throw new NotFoundException('Expense report not found');
    }
    const reviewable = await this.prisma.expenseItem.findMany({
      where: { expense_report_id: id, status: { in: ['submitted', 'sent_back'] } },
      select: { id: true },
    });
    if (reviewable.length === 0) {
      throw new UnprocessableEntityException('this folder has no items awaiting review');
    }
    const result = await this.expenses.bulkReview({ ids: reviewable.map((i) => i.id), decision: dto.decision, note: dto.note }, user);
    const folder = await this.findOne(id, user);
    return { ...result, folder };
  }
}
