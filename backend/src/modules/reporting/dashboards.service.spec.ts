import { ForbiddenException } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  email: 'u@x.co',
  full_name: 'U',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(),
  repId: 'rep-1',
  ...over,
});

function make(scopeLevel: 'all' | 'roster' | 'self' = 'self', repIds: string[] = ['rep-1']) {
  const agg = { _sum: {} as Record<string, unknown> };
  const prisma = {
    payPeriod: { findMany: jest.fn().mockResolvedValue([{ id: 'P1', period_number: 1, start_date: D('2000-01-01'), end_date: D('2100-01-01') }]) },
    saleItem: { groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    payRunLine: { aggregate: jest.fn().mockResolvedValue(agg) },
    holdbackLedger: { aggregate: jest.fn().mockResolvedValue(agg) },
    clawback: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue(agg) },
    clientStatement: { aggregate: jest.fn().mockResolvedValue(agg), groupBy: jest.fn().mockResolvedValue([]) },
    client: { findMany: jest.fn().mockResolvedValue([]) },
    productTypeCatalogue: { findMany: jest.fn().mockResolvedValue([]) },
    expenseItem: { groupBy: jest.fn().mockResolvedValue([]) },
    commissionTierConfig: { findMany: jest.fn().mockResolvedValue([{ effective_from: D('2000-01-01'), effective_to: null, tiers: [{ tier_number: 4, min_count: 0, max_count: 6 }] }]) },
    sale: { count: jest.fn().mockResolvedValue(2), groupBy: jest.fn().mockResolvedValue([]) },
    expenseReport: { count: jest.fn().mockResolvedValue(1) },
    profileChangeRequest: { count: jest.fn().mockResolvedValue(3) },
    signatureRequest: { count: jest.fn().mockResolvedValue(4) },
    payRun: { count: jest.fn().mockResolvedValue(5) },
    rep: { count: jest.fn().mockResolvedValue(7), findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = { getRepScope: jest.fn().mockResolvedValue(scopeLevel === 'all' ? { level: 'all' } : { level: scopeLevel, repIds }) };
  const service = new DashboardsService(prisma as never, audit as never, scope as never);
  return { service, prisma, audit };
}

describe('DashboardsService.rep (own data only — RPT-001)', () => {
  it('scopes every read to the caller’s own repId', async () => {
    const { service, prisma } = make();
    await service.rep(user({ repId: 'rep-1' }));
    const countWhere = (prisma.saleItem.count.mock.calls[0][0] as { where: { sale: { rep_id: string } } }).where;
    expect(countWhere.sale.rep_id).toBe('rep-1');
    const aggWhere = (prisma.payRunLine.aggregate.mock.calls[0][0] as { where: { rep_id: string } }).where;
    expect(aggWhere.rep_id).toBe('rep-1');
  });

  it('a caller with no linked rep → 403 + audit', async () => {
    const { service, audit } = make();
    await expect(service.rep(user({ repId: null }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied' }));
  });
});

describe('DashboardsService.manager (roster only — RPT-002)', () => {
  it('scopes to the caller’s roster repIds', async () => {
    const { service, prisma } = make('roster', ['r1', 'r2']);
    await service.manager(user());
    const where = (prisma.sale.count.mock.calls[0][0] as { where: { rep_id: { in: string[] } } }).where;
    expect(where.rep_id.in).toEqual(['r1', 'r2']); // never another manager's roster
  });

  it('a bare rep (scope=self) → 403', async () => {
    const { service } = make('self', ['rep-1']);
    await expect(service.manager(user())).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DashboardsService.business (Super Admin only — RPT-003)', () => {
  it('a non-Super-Admin (even Admin) → 403 + audit', async () => {
    const { service, audit } = make('all');
    await expect(service.business(user({ roleNames: ['Admin'] }), {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied' }));
  });

  it('a Super Admin gets company-wide figures (net margin = revenue − payout) + the rich KPI shape', async () => {
    const { service, prisma } = make('all');
    prisma.clientStatement.aggregate.mockResolvedValue({ _sum: { total_amount: '1000.00' } });
    prisma.payRunLine.aggregate.mockResolvedValue({ _sum: { net_payout: '600.00', commission_70: '500.00', holdback_release_30: '200.00' } });
    prisma.clawback.aggregate.mockResolvedValue({ _sum: { amount: '50.00' } });
    const result = await service.business(user({ isSuperAdmin: true }), {});
    expect(result.revenue).toBe('1000.00');
    expect(result.rep_payout).toBe('600.00');
    expect(result.net_margin).toBe('400.00');
    expect(result.net_margin_pct).toBe('40.0'); // 400/1000
    expect(result.holdback.released_this_period).toBe('200.00');
    expect(result.clawback_total).toBe('50.00');
    expect(result.clawback_rate).toBe('0.1000'); // 50 / 500 (paid commission), exact-decimal ratio
    expect(result.expense).toEqual({ total: '0.00', km: '0.00', other: '0.00' });
    expect(result.validation_funnel).toEqual({ entered: 0, validated: 0, in_pay_run: 0, paid: 0 });
    expect(Array.isArray(result.tier_distribution)).toBe(true);
  });
});

describe('DashboardsService.admin (queues — RPT-004)', () => {
  it('returns the operational queue counts for an Admin', async () => {
    const { service } = make('all');
    const result = await service.admin(user({ roleNames: ['Admin'] }));
    expect(result).toEqual({
      pending_validations: 2,
      pending_expense_approvals: 1,
      pending_profile_changes: 3,
      pending_signature_requests: 4,
      draft_pay_runs: 5,
    });
  });

  it('a rep/manager → 403', async () => {
    const { service } = make('self');
    await expect(service.admin(user())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
