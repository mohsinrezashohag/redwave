import { LeaderboardService } from './leaderboard.service';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const item = (repId: string, status = 'validated') => ({ sale: { rep_id: repId, status } });

function make(items: ReturnType<typeof item>[]) {
  const prisma = {
    payPeriod: { findMany: jest.fn().mockResolvedValue([{ id: 'P1', period_number: 1, start_date: D('2000-01-01'), end_date: D('2100-01-01') }]) },
    saleItem: { findMany: jest.fn().mockResolvedValue(items) },
    rep: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'a', rep_code: 'A', full_name: 'Alice' },
        { id: 'b', rep_code: 'B', full_name: 'Bob' },
        { id: 'c', rep_code: 'C', full_name: 'Cara' },
      ]),
    },
  };
  return { service: new LeaderboardService(prisma as never), prisma };
}

const MONEY_KEYS = /commission|payout|earning|amount|net|money|holdback|dollar|rate|total/;

describe('LeaderboardService.list (RPT-007 — counts only)', () => {
  it('ranks by approved count and carries NO money fields', async () => {
    const { service } = make([
      ...Array.from({ length: 9 }, () => item('b')),
      ...Array.from({ length: 5 }, () => item('a', 'paid')),
    ]);
    const result = await service.list();
    expect(result.rankings.map((r) => [r.rank, r.rep_id, r.approved_count, r.activation_count])).toEqual([
      [1, 'b', 9, 9],
      [2, 'a', 5, 5],
    ]);
    // The payload must expose only counts/identity — never earnings.
    for (const row of result.rankings) {
      expect(Object.keys(row).join(',').toLowerCase()).not.toMatch(MONEY_KEYS);
    }
    expect(result.rankings[0].rep_name).toBe('Bob');
  });

  it('counts pending (entered) and approved separately; pending breaks ties; pending-only reps appear', async () => {
    const { service, prisma } = make([
      item('a', 'validated'),
      item('a', 'in_pay_run'),
      item('a', 'entered'),
      item('b', 'paid'),
      item('b', 'validated'),
      item('b', 'entered'),
      item('b', 'entered'),
      item('c', 'entered'),
    ]);
    const result = await service.list();
    expect(result.rankings.map((r) => [r.rank, r.rep_id, r.approved_count, r.pending_count])).toEqual([
      [1, 'b', 2, 2],
      [2, 'a', 2, 1],
      [3, 'c', 0, 1],
    ]);
    // The query asks for confirmed AND entered sales of the same internet tally predicate.
    const where = prisma.saleItem.findMany.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({ product_type: 'internet', counts_toward_tally: true }));
    expect(where.sale.status.in.sort()).toEqual(['entered', 'in_pay_run', 'paid', 'validated']);
  });
});
