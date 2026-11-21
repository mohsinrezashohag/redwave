import { ChatToolbox } from './chat-toolbox';
import { isToolAllowed } from './tools';
import { AI_TOOL_NAMES, FUNCTION_DECLARATIONS } from './ai-tools';
import { AuthUser } from '../../../common/rbac/auth-user.type';

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  email: 'u@x.co',
  full_name: 'U',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(['reports:view']),
  repId: 'rep-1',
  ...over,
});
const SELF = { level: 'self' as const, repIds: ['rep-1'] };
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function make() {
  const prisma = {
    payPeriod: { findMany: jest.fn().mockResolvedValue([{ id: 'P', period_number: 22, start_date: D('2000-01-01'), end_date: D('2100-01-01') }]) },
    sale: {
      groupBy: jest.fn().mockResolvedValue([{ status: 'entered', _count: { _all: 2 } }, { status: 'paid', _count: { _all: 3 } }]),
      count: jest.fn().mockResolvedValue(4),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    saleItem: { findMany: jest.fn().mockResolvedValue([]) },
    payRunLine: { findFirst: jest.fn().mockResolvedValue(null) },
    expenseItem: { groupBy: jest.fn().mockResolvedValue([]) },
    rep: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const leaderboard = {
    list: jest.fn().mockResolvedValue({
      period: { id: 'P', period_number: 22 },
      rankings: [
        { rank: 1, rep_id: 'rep-2', rep_code: 'B', rep_name: 'Bob', photo_url: null, approved_count: 9, pending_count: 1, activation_count: 9 },
        { rank: 2, rep_id: 'rep-1', rep_code: 'A', rep_name: 'Alice', photo_url: null, approved_count: 4, pending_count: 2, activation_count: 4 },
      ],
    }),
  };
  const dashboards = { business: jest.fn() };
  return { box: new ChatToolbox(prisma as never, leaderboard as never, dashboards as never), prisma };
}

describe('ChatToolbox — every tool is scoped to the caller (RPT-011, CLAUDE §5)', () => {
  it('my_sales_summary filters on the CALLER’s rep and counts by status', async () => {
    const { box, prisma } = make();
    const r = await box.run('my_sales_summary', { rep_id: 'rep-OTHER', date_from: '2026-11-01', date_to: '2026-11-14' }, user(), SELF);
    const where = prisma.sale.groupBy.mock.calls[0][0].where;
    expect(where.rep_id).toBe('rep-1');
    expect(where.sale_date).toEqual({ gte: D('2026-11-01'), lte: D('2026-11-14') });
    expect(r).toEqual(expect.objectContaining({ total_sales: 5, sales_by_status: { entered: 2, paid: 3 } }));
  });

  it('ignores a malformed date / status the model invents (falls back to the current period)', async () => {
    const { box, prisma } = make();
    const r = await box.run('my_sales_summary', { date_from: 'yesterday', status: 'deleted' }, user(), SELF);
    expect(r.pay_period_number).toBe(22);
    expect(prisma.sale.groupBy.mock.calls[0][0].where.status).toEqual({ in: ['entered', 'validated', 'in_pay_run', 'paid', 'clawed_back'] });
  });

  it('sale_status puts the caller’s scope IN the query, so another rep’s sale reads as not found', async () => {
    const { box, prisma } = make();
    const r = await box.run('sale_status', { sale_code: '2026-11-03-VF' }, user(), SELF);
    expect(prisma.sale.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ rep_id: { in: ['rep-1'] }, sale_code: { equals: '2026-11-03-VF', mode: 'insensitive' } }),
    );
    expect(r).toEqual(expect.objectContaining({ found: false }));
  });

  it('sale_status rejects an implausible code without querying', async () => {
    const { box, prisma } = make();
    const r = await box.run('sale_status', { sale_code: "x' OR 1=1 --" }, user(), SELF);
    expect(prisma.sale.findFirst).not.toHaveBeenCalled();
    expect(r.found).toBe(false);
  });

  it('pending_validation_count scopes to the roster for a manager and is company-wide only for admins', async () => {
    const { box, prisma } = make();
    await box.run('pending_validation_count', {}, user(), { level: 'roster', repIds: ['rep-1', 'rep-3'] });
    expect(prisma.sale.count.mock.calls[0][0].where).toEqual({ status: 'entered', rep_id: { in: ['rep-1', 'rep-3'] } });
    await box.run('pending_validation_count', {}, user(), { level: 'all' });
    expect(prisma.sale.count.mock.calls[1][0].where).toEqual({ status: 'entered' });
  });

  it('my_pay_summary reads only the caller’s finalized pay-run line', async () => {
    const { box, prisma } = make();
    const r = await box.run('my_pay_summary', {}, user(), SELF);
    expect(prisma.payRunLine.findFirst.mock.calls[0][0].where).toEqual({
      rep_id: 'rep-1',
      pay_run: { status: { in: ['finalized', 'exported'] } },
    });
    expect(r.found).toBe(false);
  });

  it('my_expenses_status reads only the caller’s own expense items', async () => {
    const { box, prisma } = make();
    await box.run('my_expenses_status', {}, user(), SELF);
    expect(prisma.expenseItem.groupBy.mock.calls[0][0].where.OR).toEqual([{ submitted_by: 'u1' }, { rep_id: 'rep-1' }]);
  });

  it('leaderboard_position is counts only (no money field)', async () => {
    const { box } = make();
    const r = await box.run('leaderboard_position', {}, user(), SELF);
    expect(r).toEqual(expect.objectContaining({ your_rank: 2, your_approved: 4, your_pending: 2 }));
    expect(JSON.stringify(r)).not.toMatch(/commission|payout|amount|earning|\$/i);
  });
});

describe('isToolAllowed — AI tools', () => {
  it('a rep may not run team or business tools; a manager may run team_summary; only the SA runs business', () => {
    expect(isToolAllowed('team_summary', user(), 'self')).toBe(false);
    expect(isToolAllowed('business_summary', user(), 'self')).toBe(false);
    expect(isToolAllowed('team_summary', user(), 'roster')).toBe(true);
    expect(isToolAllowed('business_summary', user(), 'all')).toBe(false);
    expect(isToolAllowed('business_summary', user({ isSuperAdmin: true }), 'all')).toBe(true);
  });

  it('personal tools need a rep profile; the leaderboard also needs reports:view; unknown names are refused', () => {
    expect(isToolAllowed('my_pay_summary', user({ repId: null }), 'all')).toBe(false);
    expect(isToolAllowed('leaderboard_position', user({ permissions: new Set() }), 'self')).toBe(false);
    expect(isToolAllowed('my_expenses_status', user({ repId: null }), 'self')).toBe(true);
    expect(isToolAllowed('drop_tables', user({ isSuperAdmin: true }), 'all')).toBe(false);
  });

  it('every declared function is an allow-listed tool and none takes an id parameter (except sale_code)', () => {
    expect(FUNCTION_DECLARATIONS.map((d) => d.name).sort()).toEqual([...AI_TOOL_NAMES].sort());
    const params = JSON.stringify(FUNCTION_DECLARATIONS.map((d) => d.parameters ?? {}));
    expect(params).not.toMatch(/rep_id|user_id|client_id|"id"/);
  });
});
