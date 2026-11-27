/**
 * ChatToolbox — the AI assistant's SCOPED data tools. Each tool takes ONLY the AuthUser (+ the caller's
 * ScopeService scope) and sanitized arguments, queries with the scope IN the `where` (CLAUDE §5), and
 * returns compact JSON for the model to phrase. No tool accepts a rep / user / client id from the model;
 * `sale_status` takes a sale code and answers "not found" for anything outside the caller's scope, the
 * same as for a code that doesn't exist. Money is READ from frozen rows and returned as decimal strings
 * (#1); nothing is recomputed. The leaderboard and team tools return counts only (§5). — SRS RPT-011
 *
 * Not a Nest provider: ChatbotService builds it from its own injected dependencies, so no module change.
 */
import { Prisma, PayRunStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthUser } from '../../../common/rbac/auth-user.type';
import { RepScope } from '../../../common/scope/scope.service';
import { todayInWinnipeg, winnipegDateOnly } from '../../../common/timezone';
import { currentPeriod } from '../period.logic';
import { LeaderboardService } from '../leaderboard.service';
import { DashboardsService } from '../dashboards.service';
import { AiToolName, asArgs, cleanDate, cleanRepCode, cleanSaleCode, cleanStatus, FILTERABLE_SALE_STATUSES } from './ai-tools';

const CONFIRMED: SaleStatus[] = ['validated', 'in_pay_run', 'paid'];
const FINALIZED: PayRunStatus[] = ['finalized', 'exported'];
const DAY = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ISO = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type ToolResult = Record<string, unknown>;

export class ChatToolbox {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly dashboards: DashboardsService,
  ) {}

  /** Run one allow-listed tool for the caller. The entitlement gate has ALREADY passed. */
  async run(name: AiToolName, rawArgs: unknown, user: AuthUser, scope: RepScope): Promise<ToolResult> {
    const args = asArgs(rawArgs);
    switch (name) {
      case 'my_sales_summary':
        return this.mySalesSummary(user, args);
      case 'pending_validation_count':
        return this.pendingValidationCount(scope);
      case 'sale_status':
        return this.saleStatus(scope, args);
      case 'my_pay_summary':
        return this.myPaySummary(user);
      case 'my_expenses_status':
        return this.myExpensesStatus(user, args);
      case 'leaderboard_position':
        return this.leaderboardPosition(user);
      case 'team_summary':
        return this.teamSummary(scope, args);
      case 'business_summary': {
        const d = await this.dashboards.business(user, {});
        return { revenue_cad: d.revenue, rep_payout_cad: d.rep_payout, net_margin_cad: d.net_margin };
      }
      case 'rep_lookup':
        return this.repLookup(scope, args);
      default:
        return { error: 'unknown tool' };
    }
  }

  /** The caller's rep-id filter. `null` = company-wide (admin scope). */
  private repFilter(scope: RepScope): string[] | null {
    return scope.level === 'all' ? null : scope.repIds;
  }

  /** The requested range, defaulting to the current pay period (Winnipeg "today", #7). */
  private async range(args: Record<string, unknown>) {
    let from = cleanDate(args.date_from);
    let to = cleanDate(args.date_to);
    let periodNumber: number | null = null;
    if (!from && !to) {
      const periods = await this.prisma.payPeriod.findMany({
        select: { id: true, period_number: true, start_date: true, end_date: true },
      });
      const p = currentPeriod(periods, winnipegDateOnly());
      if (p) {
        from = ISO(p.start_date)!;
        to = ISO(p.end_date)!;
        periodNumber = p.period_number;
      } else {
        to = todayInWinnipeg();
        from = `${to.slice(0, 8)}01`;
      }
    }
    if (from && to && from > to) [from, to] = [to, from];
    const where: Prisma.DateTimeFilter = {};
    if (from) where.gte = DAY(from);
    if (to) where.lte = DAY(to);
    return { from: from ?? null, to: to ?? null, periodNumber, where };
  }

  private async mySalesSummary(user: AuthUser, args: Record<string, unknown>): Promise<ToolResult> {
    const range = await this.range(args);
    const status = cleanStatus(args.status);
    const where: Prisma.SaleWhereInput = {
      rep_id: user.repId!, // the CALLER's own rep — never an id from the model
      sale_date: range.where,
      status: status ? status : { in: [...FILTERABLE_SALE_STATUSES] },
    };
    const [groups, tally] = await Promise.all([
      this.prisma.sale.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.internetTally({ ...where }),
    ]);
    const by_status = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    return {
      date_from: range.from,
      date_to: range.to,
      pay_period_number: range.periodNumber,
      sales_by_status: by_status,
      total_sales: groups.reduce((n, g) => n + g._count._all, 0),
      internet_activations_approved: tally.approved,
      internet_activations_pending: tally.pending,
    };
  }

  private async pendingValidationCount(scope: RepScope): Promise<ToolResult> {
    const reps = this.repFilter(scope);
    const where: Prisma.SaleWhereInput = { status: 'entered', ...(reps ? { rep_id: { in: reps } } : {}) };
    const [count, oldest] = await Promise.all([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findFirst({ where, orderBy: { sale_date: 'asc' }, select: { sale_date: true } }),
    ]);
    return {
      scope: scope.level === 'all' ? 'company' : scope.level === 'roster' ? 'your team' : 'your own sales',
      pending_validation: count,
      oldest_pending_sale_date: ISO(oldest?.sale_date),
    };
  }

  private async saleStatus(scope: RepScope, args: Record<string, unknown>): Promise<ToolResult> {
    const code = cleanSaleCode(args.sale_code);
    const notFound = { found: false, message: 'No sale with that Sale ID is visible to you.' };
    if (!code) return notFound;
    const reps = this.repFilter(scope);
    // Scope is IN the query: an out-of-scope sale is indistinguishable from a missing one.
    const sale = await this.prisma.sale.findFirst({
      where: {
        sale_code: { equals: code, mode: 'insensitive' },
        status: { not: 'deleted' },
        ...(reps ? { rep_id: { in: reps } } : {}),
      },
      select: {
        sale_code: true,
        status: true,
        sale_date: true,
        validated_at: true,
        client: { select: { client_code: true } },
        sale_items: { select: { product_type: true } },
      },
    });
    if (!sale) return notFound;
    return {
      found: true,
      sale_code: sale.sale_code,
      status: sale.status,
      sale_date: ISO(sale.sale_date),
      validated_on: ISO(sale.validated_at),
      client: sale.client.client_code,
      products: sale.sale_items.map((i) => i.product_type),
    };
  }

  /**
   * Who a rep is, by rep code or partner code. Scope is IN the query, so an out-of-scope rep answers exactly
   * like an unknown code. Name, status and manager only: no money, no contact or private details. 2026-11-28
   */
  async repLookup(scope: RepScope, args: Record<string, unknown>): Promise<ToolResult> {
    const code = cleanRepCode(args.rep_code);
    const notFound = { found: false, message: 'No rep with that code is visible to you.' };
    if (!code) return notFound;
    const reps = this.repFilter(scope);
    const rep = await this.prisma.rep.findFirst({
      where: {
        OR: [{ rep_code: { equals: code, mode: 'insensitive' } }, { external_code: { equals: code, mode: 'insensitive' } }],
        ...(reps ? { id: { in: reps } } : {}),
      },
      select: { rep_code: true, external_code: true, full_name: true, status: true, field_manager: { select: { full_name: true } } },
    });
    if (!rep) return notFound;
    return {
      found: true,
      rep_code: rep.rep_code,
      partner_code: rep.external_code,
      name: rep.full_name,
      status: rep.status,
      field_manager: rep.field_manager?.full_name ?? null,
    };
  }

  private async myPaySummary(user: AuthUser): Promise<ToolResult> {
    const line = await this.prisma.payRunLine.findFirst({
      where: { rep_id: user.repId!, pay_run: { status: { in: FINALIZED } } },
      orderBy: [{ pay_run: { run_date: 'desc' } }, { pay_run: { created_at: 'desc' } }],
      select: {
        commission: true,
        expense_total: true,
        incentive_total: true,
        bonus_amount: true,
        clawback_total: true,
        net_payout: true,
        pay_run: {
          select: {
            label: true,
            run_date: true,
            date_from: true,
            date_to: true,
            pay_period: { select: { period_number: true, payday: true } },
          },
        },
      },
    });
    if (!line) return { found: false, message: 'No finalized pay statement yet.' };
    // Frozen pay-run figures, read as exact decimal strings (#1/#8) — never recomputed.
    return {
      found: true,
      currency: 'CAD',
      run_label: line.pay_run.label,
      run_date: ISO(line.pay_run.run_date),
      covers_from: ISO(line.pay_run.date_from),
      covers_to: ISO(line.pay_run.date_to),
      pay_period_number: line.pay_run.pay_period?.period_number ?? null,
      payday: ISO(line.pay_run.pay_period?.payday),
      commission: line.commission.toFixed(2),
      expenses: line.expense_total.toFixed(2),
      incentives: line.incentive_total.toFixed(2),
      bonus: line.bonus_amount.toFixed(2),
      clawbacks: line.clawback_total.toFixed(2),
      net_payout: line.net_payout.toFixed(2),
    };
  }

  private async myExpensesStatus(user: AuthUser, args: Record<string, unknown>): Promise<ToolResult> {
    const from = cleanDate(args.date_from);
    const to = cleanDate(args.date_to);
    const own: Prisma.ExpenseItemWhereInput[] = [{ submitted_by: user.id }];
    if (user.repId) own.push({ rep_id: user.repId });
    const where: Prisma.ExpenseItemWhereInput = {
      OR: own,
      ...(from || to ? { expense_date: { ...(from ? { gte: DAY(from) } : {}), ...(to ? { lte: DAY(to) } : {}) } } : {}),
    };
    const groups = await this.prisma.expenseItem.groupBy({
      by: ['status', 'original_currency'],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    });
    const byStatus = new Map<string, { status: string; count: number; totals: { currency: string; amount: string }[] }>();
    for (const g of groups) {
      const entry = byStatus.get(g.status) ?? { status: g.status, count: 0, totals: [] };
      entry.count += g._count._all;
      entry.totals.push({ currency: g.original_currency, amount: (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) });
      byStatus.set(g.status, entry);
    }
    return { date_from: from ?? null, date_to: to ?? null, by_status: [...byStatus.values()] };
  }

  private async leaderboardPosition(user: AuthUser): Promise<ToolResult> {
    const board = await this.leaderboard.list();
    const mine = board.rankings.find((r) => r.rep_id === user.repId);
    // COUNTS ONLY — the leaderboard has no money field (§5).
    return {
      pay_period_number: board.period?.period_number ?? null,
      ranked_reps: board.rankings.length,
      your_rank: mine?.rank ?? null,
      your_approved: mine?.approved_count ?? 0,
      your_pending: mine?.pending_count ?? 0,
      top: board.rankings.slice(0, 3).map((r) => ({
        rank: r.rank,
        name: r.rep_name,
        approved: r.approved_count,
        pending: r.pending_count,
      })),
    };
  }

  private async teamSummary(scope: RepScope, args: Record<string, unknown>): Promise<ToolResult> {
    const range = await this.range(args);
    const reps = this.repFilter(scope);
    const where: Prisma.SaleWhereInput = {
      sale_date: range.where,
      status: { in: [...FILTERABLE_SALE_STATUSES] },
      ...(reps ? { rep_id: { in: reps } } : {}),
    };
    const [groups, items] = await Promise.all([
      this.prisma.sale.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.saleItem.findMany({
        where: { product_type: 'internet', counts_toward_tally: true, sale: { ...where, status: { in: [...CONFIRMED, 'entered'] } } },
        select: { sale: { select: { rep_id: true, status: true } } },
      }),
    ]);
    const perRep = new Map<string, { approved: number; pending: number }>();
    for (const it of items) {
      const t = perRep.get(it.sale.rep_id) ?? { approved: 0, pending: 0 };
      if (it.sale.status === 'entered') t.pending += 1;
      else t.approved += 1;
      perRep.set(it.sale.rep_id, t);
    }
    const ranked = [...perRep.entries()].sort((a, b) => b[1].approved - a[1].approved || b[1].pending - a[1].pending);
    const top = ranked.slice(0, scope.level === 'all' ? 10 : 25);
    const names = await this.prisma.rep.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, full_name: true, rep_code: true },
    });
    const byId = new Map(names.map((r) => [r.id, r]));
    // COUNTS ONLY (§5) — no rep money crosses this tool.
    return {
      scope: scope.level === 'all' ? 'company' : 'your team',
      date_from: range.from,
      date_to: range.to,
      pay_period_number: range.periodNumber,
      team_size: reps ? reps.length : null,
      sales_by_status: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
      internet_activations_approved: ranked.reduce((n, [, t]) => n + t.approved, 0),
      internet_activations_pending: ranked.reduce((n, [, t]) => n + t.pending, 0),
      reps: top.map(([id, t]) => ({
        name: byId.get(id)?.full_name ?? null,
        rep_code: byId.get(id)?.rep_code ?? null,
        approved: t.approved,
        pending: t.pending,
      })),
    };
  }

  /** Approved / pending internet activations (the leaderboard's tally predicate) for a sale filter. */
  private async internetTally(saleWhere: Prisma.SaleWhereInput) {
    const items = await this.prisma.saleItem.findMany({
      where: { product_type: 'internet', counts_toward_tally: true, sale: saleWhere },
      select: { sale: { select: { status: true } } },
    });
    let approved = 0;
    let pending = 0;
    for (const it of items) {
      if (it.sale.status === 'entered') pending += 1;
      else if (CONFIRMED.includes(it.sale.status)) approved += 1;
    }
    return { approved, pending };
  }
}
