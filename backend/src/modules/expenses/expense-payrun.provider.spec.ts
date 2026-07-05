import { ExpensePayrunProvider } from './expense-payrun.provider';

const decLike = (s: string) => ({ toString: () => s });

function make() {
  const prisma = { expenseItem: { findMany: jest.fn() } };
  const provider = new ExpensePayrunProvider(prisma as never);
  return { provider, prisma };
}

describe('ExpensePayrunProvider.getApprovedExpenseTotal (Pay Run seam)', () => {
  it('sums the rep’s approved item FROZEN CAD values for the period (exact Decimal, #12)', async () => {
    const { provider, prisma } = make();
    prisma.expenseItem.findMany.mockResolvedValue([
      { amount_cad: decLike('31.50') },
      { amount_cad: decLike('42.50') }, // e.g. a foreign item already converted at approval
      { amount_cad: decLike('0.01') },
    ]);
    const total = await provider.getApprovedExpenseTotal('rep-1', 'P1');
    expect(total.toFixed(2)).toBe('74.01');
  });

  it('reads amount_cad (NOT amount) — a foreign expense reaches the pay run already in CAD (#12)', async () => {
    const { provider, prisma } = make();
    prisma.expenseItem.findMany.mockResolvedValue([]);
    await provider.getApprovedExpenseTotal('rep-1', 'P1');
    const select = (prisma.expenseItem.findMany.mock.calls[0][0] as { select: Record<string, unknown> }).select;
    expect(select).toEqual({ amount_cad: true });
  });

  // ITEM-FIRST + EXP-009: the sum is scoped on the ITEM's own pay_period_id (derived from its
  // expense_date), NOT through the report — so an approved item pays in the cycle of its date.
  // A personal (do-not-reimburse) item is excluded at the query (EXP-012).
  it('queries only APPROVED, non-personal items for that rep + period at the ITEM level (no report join)', async () => {
    const { provider, prisma } = make();
    prisma.expenseItem.findMany.mockResolvedValue([]);
    await provider.getApprovedExpenseTotal('rep-9', 'P7');
    const where = (prisma.expenseItem.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ rep_id: 'rep-9', pay_period_id: 'P7', status: 'approved', is_personal: false });
    expect(where).not.toHaveProperty('expense_report');
  });

  it('no approved items → 0', async () => {
    const { provider, prisma } = make();
    prisma.expenseItem.findMany.mockResolvedValue([]);
    expect((await provider.getApprovedExpenseTotal('rep-1', 'P1')).toFixed(2)).toBe('0.00');
  });
});
