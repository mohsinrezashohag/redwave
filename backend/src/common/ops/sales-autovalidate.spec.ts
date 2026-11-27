import { runSalesAutoValidate } from './sales-autovalidate';

function make(sales: Array<{ id: string; sale_code: string; duplicate_of_sale_id?: string | null; duplicate_approved_at?: Date | null }>, updated = sales.length) {
  const tx = {
    sale: { updateMany: jest.fn().mockResolvedValue({ count: updated }) },
    auditLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    sale: {
      findMany: jest.fn().mockResolvedValue(
        sales.map((s) => ({ duplicate_of_sale_id: null, duplicate_approved_at: null, ...s })),
      ),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'sa-1', email: 'sa@x.co' }) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

describe('runSalesAutoValidate (backlog for "no per-sale validation", 2026-11-28)', () => {
  const sales = [
    { id: 'a', sale_code: 'A' },
    { id: 'b', sale_code: 'B', duplicate_of_sale_id: 'orig' }, // held
    { id: 'c', sale_code: 'C', duplicate_of_sale_id: 'orig', duplicate_approved_at: new Date() }, // approved
  ];

  it('dry run plans every entered sale except held duplicates and writes nothing', async () => {
    const { prisma } = make(sales);
    const plan = await runSalesAutoValidate(prisma as never, { write: false });
    expect(plan).toEqual({ validate: ['A', 'C'], held: ['B'], actorEmail: 'sa@x.co' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('write validates them in one tx, as the Super Admin, with an audit row each', async () => {
    const { prisma, tx } = make(sales, 2);
    const now = new Date('2026-11-28T12:00:00Z');
    await runSalesAutoValidate(prisma as never, { write: true, now });
    expect(tx.sale.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'c'] }, status: 'entered' },
      data: { status: 'validated', validated_by: 'sa-1', validated_at: now },
    });
    const audit = tx.auditLog.createMany.mock.calls[0][0] as { data: Array<{ entity_id: string; action: string }> };
    expect(audit.data.map((r) => r.entity_id)).toEqual(['a', 'c']);
    expect(audit.data.every((r) => r.action === 'validate')).toBe(true);
  });

  it('aborts (whole tx) if a sale changed meanwhile', async () => {
    const { prisma } = make(sales, 1);
    await expect(runSalesAutoValidate(prisma as never, { write: true })).rejects.toThrow(/Nothing was written/);
  });

  it('refuses to write without an active Super Admin', async () => {
    const { prisma } = make(sales);
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(runSalesAutoValidate(prisma as never, { write: true })).rejects.toThrow(/No active Super Admin/);
  });
});
