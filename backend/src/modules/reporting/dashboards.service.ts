/**
 * DashboardsService — the four role-scoped read aggregations. EVERY read is scoped server-side in the
 * Prisma `where` (never post-filtered): rep = own `repId`, manager = roster, business = Super Admin
 * only, admin = operational queues. It recomputes NO money — every dollar is READ from already-computed
 * tables (`pay_run_lines`, `holdback_ledger`, `clawbacks`, `client_statements`); counts come from
 * `sales`/`sale_items`. Aggregation runs in the DB (groupBy/count/aggregate). — SRS §14, CLAUDE §3/§5
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { selectEffectiveRate } from '../../common/effective-dating';
import { winnipegDateOnly } from '../../common/timezone';
import { currentPeriod } from './period.logic';
import { countToTier, TierBracket } from './tier-progress.logic';
import { DashboardQuery } from './dto/dashboard-query.dto';

const CONFIRMED: SaleStatus[] = ['validated', 'in_pay_run', 'paid'];
const dec = (v: { toString(): string } | null | undefined): Decimal => new Decimal((v ?? 0).toString());
const money = (v: { toString(): string } | null | undefined): string => dec(v).toFixed(2);
const isAdmin = (u: AuthUser): boolean => u.isSuperAdmin || u.roleNames.includes(BUILTIN_ROLES.ADMIN);

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  // ── REP — own data only ───────────────────────────────────────────────────────────
  async rep(user: AuthUser) {
    if (!user.repId) {
      await this.deny(user, 'rep dashboard requires a linked rep profile');
    }
    const repId = user.repId!;
    const period = await this.currentPeriodRow();
    const saleWhere: Prisma.SaleWhereInput = {
      rep_id: repId,
      status: { in: CONFIRMED },
      ...(period ? { sale_date: { gte: period.start_date, lte: period.end_date } } : {}),
    };

    const byProduct = await this.prisma.saleItem.groupBy({
      by: ['product_type'],
      where: { sale: saleWhere },
      _count: { _all: true },
    });
    const internetTally = await this.prisma.saleItem.count({
      where: { sale: saleWhere, product_type: 'internet', counts_toward_tally: true },
    });

    const commission = await this.prisma.payRunLine.aggregate({
      where: { rep_id: repId, ...(period ? { pay_run: { pay_period_id: period.id } } : {}) },
      _sum: { commission_70: true, holdback_release_30: true, net_payout: true, incentive_total: true },
    });
    const heldAgg = await this.prisma.holdbackLedger.aggregate({
      where: { rep_id: repId, release_status: { in: ['held', 'scheduled'] } },
      _sum: { amount_held: true },
    });
    const recentClawbacks = await this.prisma.clawback.findMany({
      where: { rep_id: repId },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true, amount: true, reason: true, status: true, created_at: true },
    });

    return {
      period: period ? { id: period.id, period_number: period.period_number } : null,
      counts_by_product: byProduct.map((g) => ({ product_type: g.product_type, count: g._count._all })),
      internet_activations: internetTally,
      tier: countToTier(await this.effectiveTierBrackets(), internetTally),
      // Money — READ from frozen/computed pay-run lines + ledger (never recomputed). #1/#5
      commission: {
        commission_70: money(commission._sum.commission_70),
        holdback_release_30: money(commission._sum.holdback_release_30),
        incentive_total: money(commission._sum.incentive_total),
        net_payout: money(commission._sum.net_payout),
      },
      holdback_pending_release: money(heldAgg._sum.amount_held),
      recent_clawbacks: recentClawbacks.map((c) => ({ ...c, amount: money(c.amount) })),
    };
  }

  // ── MANAGER — roster only ───────────────────────────────────────────────────────────
  async manager(user: AuthUser) {
    const scope = await this.scope.getRepScope(user);
    if (scope.level === 'self') {
      await this.deny(user, 'manager dashboard requires a roster (you manage no reps)');
    }
    const repIds = scope.level === 'all' ? null : scope.repIds; // null = all (admin/SA)
    const period = await this.currentPeriodRow();
    const repFilter = repIds ? { in: repIds } : undefined;
    const saleWhere: Prisma.SaleWhereInput = {
      ...(repFilter ? { rep_id: repFilter } : {}),
      status: { in: CONFIRMED },
      ...(period ? { sale_date: { gte: period.start_date, lte: period.end_date } } : {}),
    };

    const teamInternet = await this.prisma.saleItem.count({
      where: { sale: saleWhere, product_type: 'internet', counts_toward_tally: true },
    });
    const pendingValidations = await this.prisma.sale.count({
      where: { ...(repFilter ? { rep_id: repFilter } : {}), status: 'entered' },
    });
    const pendingExpenseApprovals = await this.prisma.expenseReport.count({
      where: { ...(repFilter ? { rep_id: repFilter } : {}), status: 'submitted' },
    });
    const perRep = await this.prisma.saleItem.groupBy({
      by: ['sale_id'],
      where: { sale: saleWhere, product_type: 'internet', counts_toward_tally: true },
      _count: { _all: true },
    });

    return {
      period: period ? { id: period.id, period_number: period.period_number } : null,
      roster_size: repIds ? repIds.length : null,
      team_internet_activations: teamInternet,
      pending_validations: pendingValidations,
      pending_expense_approvals: pendingExpenseApprovals,
      sales_in_period: perRep.length,
    };
  }

  // ── BUSINESS — Super Admin only (reports:business). Full period-aware KPI set. ───────
  // READ-ONLY aggregation over frozen tables; net margin / clawback-rate / growth are display math (#1/#5).
  async business(user: AuthUser, query: DashboardQuery) {
    if (!user.isSuperAdmin) {
      await this.deny(user, 'the business dashboard is Super Admin only');
    }
    const periods = await this.prisma.payPeriod.findMany({
      select: { id: true, period_number: true, start_date: true, end_date: true },
      orderBy: { period_number: 'asc' },
    });
    const period = query.pay_period_id
      ? periods.find((p) => p.id === query.pay_period_id) ?? null
      : currentPeriod(periods, winnipegDateOnly());
    const prev = period
      ? periods.filter((p) => p.period_number < period.period_number).sort((a, b) => b.period_number - a.period_number)[0] ?? null
      : null;
    const saleDateIn = (p: { start_date: Date; end_date: Date } | null): Prisma.SaleWhereInput =>
      p ? { sale_date: { gte: p.start_date, lte: p.end_date } } : {};
    const periodStmt = period ? { pay_period_id: period.id } : {};

    // ── Money (frozen reads) ──
    const [revAgg, payAgg, heldAgg, schedAgg, clawAgg, expenseGroups] = await Promise.all([
      this.prisma.clientStatement.aggregate({ where: periodStmt, _sum: { total_amount: true } }),
      this.prisma.payRunLine.aggregate({
        where: period ? { pay_run: { pay_period_id: period.id } } : {},
        _sum: { net_payout: true, commission_70: true, holdback_release_30: true },
      }),
      this.prisma.holdbackLedger.aggregate({ where: { release_status: 'held' }, _sum: { amount_held: true } }),
      this.prisma.holdbackLedger.aggregate({ where: { release_status: 'scheduled' }, _sum: { amount_held: true } }),
      this.prisma.clawback.aggregate({
        where: period ? { applied_in_pay_run: { pay_period_id: period.id } } : {},
        _sum: { amount: true },
      }),
      this.prisma.expenseItem.groupBy({
        by: ['category'],
        where: { expense_report: { status: 'approved', ...periodStmt } },
        _sum: { amount: true },
      }),
    ]);
    const rev = dec(revAgg._sum.total_amount);
    const payout = dec(payAgg._sum.net_payout);
    const commission70 = dec(payAgg._sum.commission_70);
    const margin = rev.minus(payout);
    const expenseTotal = expenseGroups.reduce((a, g) => a.plus(dec(g._sum.amount)), new Decimal(0));
    const expenseKm = expenseGroups.filter((g) => g.category === 'km').reduce((a, g) => a.plus(dec(g._sum.amount)), new Decimal(0));

    // ── Activations — one confirmed-items pass, reduced in JS (bounded by the period). ──
    const items = await this.prisma.saleItem.findMany({
      where: { sale: { status: { in: CONFIRMED }, ...saleDateIn(period) } },
      select: { product_type: true, counts_toward_tally: true, commission_paid: true, sale: { select: { client_id: true, rep_id: true } } },
    });
    const byProduct = new Map<string, number>();
    const byClient = new Map<string, number>();
    const perRepTally = new Map<string, number>();
    let internet = 0;
    let greenfieldCount = 0;
    let greenfieldAmt = new Decimal(0);
    for (const it of items) {
      byProduct.set(it.product_type, (byProduct.get(it.product_type) ?? 0) + 1);
      byClient.set(it.sale.client_id, (byClient.get(it.sale.client_id) ?? 0) + 1);
      if (it.product_type === 'internet' && it.counts_toward_tally) {
        internet += 1;
        perRepTally.set(it.sale.rep_id, (perRepTally.get(it.sale.rep_id) ?? 0) + 1);
      } else if (it.product_type === 'internet' && !it.counts_toward_tally) {
        greenfieldCount += 1;
        greenfieldAmt = greenfieldAmt.plus(dec(it.commission_paid)); // frozen flat $100 (read, not recomputed)
      }
    }

    // ── Tier distribution over ALL active reps (0-activation reps land in the entry tier). ──
    const [activeReps, brackets, clients, catalogue, revByClientRows, funnelGroups] = await Promise.all([
      this.prisma.rep.findMany({ where: { status: 'active' }, select: { id: true } }),
      this.effectiveTierBrackets(),
      this.prisma.client.findMany({ select: { id: true, client_code: true, name: true } }),
      this.prisma.productTypeCatalogue.findMany({ select: { key: true, label: true } }),
      this.prisma.clientStatement.groupBy({ by: ['client_id'], where: periodStmt, _sum: { total_amount: true } }),
      this.prisma.sale.groupBy({ by: ['status'], where: { ...saleDateIn(period) }, _count: { _all: true } }),
    ]);
    const tierCounts = new Map<number, number>();
    for (const r of activeReps) {
      const t = countToTier(brackets, perRepTally.get(r.id) ?? 0);
      if (t) tierCounts.set(t.tier_number, (tierCounts.get(t.tier_number) ?? 0) + 1);
    }

    // ── Client mix + labels ──
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const typeLabel = new Map(catalogue.map((t) => [t.key, t.label]));
    const revByClient = new Map(revByClientRows.map((r) => [r.client_id, dec(r._sum.total_amount)]));
    const totalVolume = items.length;
    const clientMix = clients
      .map((c) => {
        const r = revByClient.get(c.id) ?? new Decimal(0);
        const vol = byClient.get(c.id) ?? 0;
        return {
          client_code: c.client_code,
          client_name: c.name,
          revenue: r.toFixed(2),
          revenue_pct: rev.isZero() ? '0.0' : r.div(rev).times(100).toFixed(1),
          volume: vol,
          volume_pct: totalVolume === 0 ? '0.0' : new Decimal(vol).div(totalVolume).times(100).toFixed(1),
        };
      })
      .filter((m) => Number(m.revenue) > 0 || m.volume > 0)
      .sort((a, b) => Number(b.revenue) - Number(a.revenue));

    const funnelOf = (s: SaleStatus) => funnelGroups.find((g) => g.status === s)?._count._all ?? 0;

    // ── Period-over-period growth ──
    const [revPrevAgg, actPrev] = await Promise.all([
      prev ? this.prisma.clientStatement.aggregate({ where: { pay_period_id: prev.id }, _sum: { total_amount: true } }) : Promise.resolve(null),
      prev
        ? this.prisma.saleItem.count({ where: { sale: { status: { in: CONFIRMED }, sale_date: { gte: prev.start_date, lte: prev.end_date } } } })
        : Promise.resolve(0),
    ]);
    const revPrev = dec(revPrevAgg?._sum.total_amount);
    const growthPct = (cur: Decimal | number, prv: Decimal | number): string | null => {
      const c = new Decimal(cur.toString());
      const p = new Decimal(prv.toString());
      return !prev || p.isZero() ? null : c.minus(p).div(p).times(100).toFixed(1);
    };

    return {
      period: period ? { id: period.id, period_number: period.period_number } : null,
      revenue: rev.toFixed(2),
      rep_payout: payout.toFixed(2),
      net_margin: margin.toFixed(2),
      net_margin_pct: rev.isZero() ? '0.0' : margin.div(rev).times(100).toFixed(1),
      holdback: {
        held: money(heldAgg._sum.amount_held),
        scheduled: money(schedAgg._sum.amount_held),
        released_this_period: money(payAgg._sum.holdback_release_30),
      },
      clawback_total: money(clawAgg._sum.amount),
      clawback_rate: commission70.isZero() ? '0.0000' : dec(clawAgg._sum.amount).div(commission70).toFixed(4),
      expense: { total: expenseTotal.toFixed(2), km: expenseKm.toFixed(2), other: expenseTotal.minus(expenseKm).toFixed(2) },
      total_activations: items.length,
      internet_activations: internet,
      greenfield: { count: greenfieldCount, amount: greenfieldAmt.toFixed(2) },
      activations_by_product: [...byProduct.entries()]
        .map(([key, count]) => ({ key, label: typeLabel.get(key) ?? key, count }))
        .sort((a, b) => b.count - a.count),
      activations_by_client: [...byClient.entries()]
        .map(([id, count]) => ({ key: clientById.get(id)?.client_code ?? id, label: clientById.get(id)?.name ?? id, count }))
        .sort((a, b) => b.count - a.count),
      validation_funnel: {
        entered: funnelOf('entered'),
        validated: funnelOf('validated'),
        in_pay_run: funnelOf('in_pay_run'),
        paid: funnelOf('paid'),
      },
      active_rep_count: activeReps.length,
      tier_distribution: [...tierCounts.entries()].map(([tier_number, rep_count]) => ({ tier_number, rep_count })).sort((a, b) => a.tier_number - b.tier_number),
      client_mix: clientMix,
      revenue_growth: { current: rev.toFixed(2), previous: revPrev.toFixed(2), pct: growthPct(rev, revPrev) },
      activation_growth: { current: internet, previous: actPrev, pct: growthPct(internet, actPrev) },
    };
  }

  // ── ADMIN — operational queues (counts) ─────────────────────────────────────────────
  async admin(user: AuthUser) {
    if (!isAdmin(user)) {
      await this.deny(user, 'the admin operational home is Admin/Super Admin only');
    }
    const [pendingValidations, pendingExpenseApprovals, pendingProfileChanges, pendingSignatures, draftPayRuns] =
      await Promise.all([
        this.prisma.sale.count({ where: { status: 'entered' } }),
        this.prisma.expenseReport.count({ where: { status: 'submitted' } }),
        this.prisma.profileChangeRequest.count({ where: { status: 'pending' } }),
        this.prisma.signatureRequest.count({ where: { status: 'pending' } }),
        this.prisma.payRun.count({ where: { status: 'draft' } }),
      ]);
    return {
      pending_validations: pendingValidations,
      pending_expense_approvals: pendingExpenseApprovals,
      pending_profile_changes: pendingProfileChanges,
      pending_signature_requests: pendingSignatures,
      draft_pay_runs: draftPayRuns,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────────────
  private async currentPeriodRow() {
    const periods = await this.prisma.payPeriod.findMany({
      select: { id: true, period_number: true, start_date: true, end_date: true },
    });
    return currentPeriod(periods, winnipegDateOnly()); // "today" in Winnipeg — CLAUDE §11
  }

  private async effectiveTierBrackets(): Promise<TierBracket[]> {
    const headers = await this.prisma.commissionTierConfig.findMany({ include: { tiers: true } });
    const header = selectEffectiveRate(headers, winnipegDateOnly());
    return (header?.tiers ?? []).map((t) => ({
      tier_number: t.tier_number,
      min_count: t.min_count,
      max_count: t.max_count,
    }));
  }

  private async deny(user: AuthUser, reason: string): Promise<never> {
    await this.audit.log({
      actorId: user.id,
      entityType: 'reports',
      entityId: user.id,
      action: 'access_denied',
      after: { reason },
    });
    throw new ForbiddenException(reason);
  }
}
