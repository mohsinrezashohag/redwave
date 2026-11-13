import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PayRunService } from './pay-run.service';
import { ZeroExpenseTotalProvider } from './seams/expense-total.provider';
import { ZeroClawbackTotalProvider } from './seams/clawback-total.provider';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user: AuthUser = {
  id: 'admin-1',
  email: 'a@x.co',
  full_name: 'Admin',
  status: 'active',
  roleNames: [],
  isSuperAdmin: true,
  permissions: new Set(),
  repId: null,
};

// A crafted engine result for one rep with a single internet activation at a flat $110 (no tiers, no split
// since 2026-11-13).
const ENGINE_RESULT = {
  items: [
    {
      id: 'item-1',
      productType: 'internet',
      rateApplied: new Decimal('110'),
      commissionBase: new Decimal('110'),
      incentiveId: null,
      incentiveAmount: new Decimal('0'),
      commissionPaid: new Decimal('110'),
    },
  ],
  commissionTotal: new Decimal('110'),
  incentiveTotal: new Decimal('0'),
  totalEarned: new Decimal('110'),
};

const decLike = (v: string) => ({ toString: () => v });

function make(opts: { runStatus?: string; bonuses?: unknown[]; clawbackTotal?: string; scopeRepIds?: string[] } = {}) {
  const runStatus = opts.runStatus ?? 'draft';
  const period = {
    id: 'P1',
    start_date: new Date('2026-01-04T00:00:00.000Z'),
    end_date: new Date('2026-01-17T00:00:00.000Z'),
    payday: new Date('2026-01-30T00:00:00.000Z'),
    status: 'open',
  };
  const tx = {
    payRunLine: { deleteMany: jest.fn(), create: jest.fn() },
    sale: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'sale-1',
          client_id: 'VF',
          sale_date: new Date('2026-01-10T00:00:00.000Z'),
          sale_items: [{ id: 'item-1', product_type: 'internet', counts_toward_tally: true }],
        },
      ]),
      updateMany: jest.fn(),
    },
    saleItem: { update: jest.fn() },
    // The payroll-report line frozen alongside the snapshots (same tx, same engine result).
    payrollReportLine: { deleteMany: jest.fn(), create: jest.fn() },
    payRun: { update: jest.fn() },
    payPeriod: { update: jest.fn() },
  };
  const prisma = {
    payPeriod: {
      findUnique: jest.fn().mockResolvedValue(period),
      findMany: jest.fn().mockResolvedValue([period]),
    },
    payRun: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'run-1', status: runStatus, pay_period: period }),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    payRunLine: {
      findMany: jest.fn().mockResolvedValue(opts.bonuses ?? []),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    sale: { findMany: jest.fn().mockResolvedValue([{ rep_id: 'rep-1' }]) }, // repsWithValidatedSales (distinct)
    rep: { findMany: jest.fn().mockResolvedValue([{ id: 'rep-1', user_id: null }]) }, // pay_run_finalized recipients
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = {
    getRepScope: jest
      .fn()
      .mockResolvedValue(opts.scopeRepIds ? { level: 'roster', repIds: opts.scopeRepIds } : { level: 'all' }),
  };
  // The engine is mocked, so the config it is handed is never read here.
  const config = {
    getEngineConfig: jest.fn().mockResolvedValue({ flatRates: {} }),
  };
  const engine = { computePeriod: jest.fn().mockReturnValue(ENGINE_RESULT) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const clawbackSeam = opts.clawbackTotal
    ? { getClawbackTotal: jest.fn().mockResolvedValue(new Decimal(opts.clawbackTotal)), markApplied: jest.fn().mockResolvedValue(undefined) }
    : new ZeroClawbackTotalProvider();
  const service = new PayRunService(
    prisma as never,
    audit as never,
    scope as never,
    config as never,
    engine as never,
    new ZeroExpenseTotalProvider(),
    clawbackSeam as never,
    emitter as never,
  );
  return { service, prisma, tx, engine, clawbackSeam, period };
}

const lineArg = (tx: ReturnType<typeof make>['tx']) =>
  (tx.payRunLine.create.mock.calls[0][0] as { data: Record<string, string> }).data;

describe('PayRunService.finalize — paid in full (no tiers, no 70/30 since 2026-11-13)', () => {
  it('FREEZES snapshots, transitions sales to Paid and pays the commission in full (atomic)', async () => {
    const { service, tx } = make();
    await service.finalize('run-1', user);

    // (#2) immutable snapshot frozen onto the sale_item
    expect(tx.saleItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({ rate_applied: '110.00', commission_paid: '110.00' }),
      }),
    );
    // §16: validated → in_pay_run → paid
    expect(tx.sale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'in_pay_run' }) }),
    );
    expect(tx.sale.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'paid' } }));
    expect(lineArg(tx).commission).toBe('110.00');
    expect(lineArg(tx).net_payout).toBe('110.00');
    expect(tx.payRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'finalized' } }));
    expect(tx.payPeriod.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'paid' } }));
  });

  it('is IDEMPOTENT — re-finalizing a finalized run is a no-op (no transaction)', async () => {
    const { service, prisma } = make({ runStatus: 'finalized' });
    await service.finalize('run-1', user);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is ATOMIC — a mid-finalize failure rejects and never marks the run finalized', async () => {
    const { service, tx } = make();
    tx.saleItem.update.mockRejectedValue(new Error('boom'));
    await expect(service.finalize('run-1', user)).rejects.toThrow('boom');
    expect(tx.payRun.update).not.toHaveBeenCalled(); // rolled back; never finalized
  });

  it('applies a bonus; expense/clawback seams resolve to 0', async () => {
    const { service, tx } = make({
      bonuses: [{ rep_id: 'rep-1', bonus_amount: decLike('50.00'), bonus_note: 'spiff' }],
    });
    await service.finalize('run-1', user);
    expect(lineArg(tx).bonus_amount).toBe('50.00');
    expect(lineArg(tx).expense_total).toBe('0.00');
    expect(lineArg(tx).clawback_total).toBe('0.00');
    expect(lineArg(tx).net_payout).toBe('160.00'); // 110 + 50 bonus
  });

  it('a clawback deducts IN FULL from net (flat) and is marked applied once', async () => {
    const { service, tx, clawbackSeam } = make({ clawbackTotal: '20.00' });
    await service.finalize('run-1', user);
    expect(lineArg(tx).clawback_total).toBe('20.00');
    expect(lineArg(tx).net_payout).toBe('90.00'); // 110 − 20
    expect((clawbackSeam as { markApplied: jest.Mock }).markApplied).toHaveBeenCalledTimes(1);
  });

  it('the DRAFT preview shows the same net finalize will pay', async () => {
    const draft = make({ clawbackTotal: '20.00' });
    await (draft.service as unknown as { computeDraftLines: (r: string, p: unknown, u: AuthUser) => Promise<void> })
      .computeDraftLines('run-1', draft.period, user);
    const fin = make({ clawbackTotal: '20.00' });
    await fin.service.finalize('run-1', user);
    expect(lineArg(draft.tx).net_payout).toBe(lineArg(fin.tx).net_payout);
  });
});

describe('PayRunService.setBonus', () => {
  it('recomputes net on a draft line', async () => {
    const { service, prisma } = make();
    prisma.payRunLine.findFirst.mockResolvedValue({
      id: 'line-1',
      commission: decLike('77.00'),
      expense_total: decLike('0.00'),
      incentive_total: decLike('0.00'),
      clawback_total: decLike('0.00'),
    });
    await service.setBonus('run-1', 'line-1', { amount: '50.00', note: 'x' }, user);
    expect(prisma.payRunLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bonus_amount: '50.00', net_payout: '127.00' }),
      }),
    );
  });
});

describe('PayRunService.exportRun — RBAC scope (PII; a manager exports only their roster)', () => {
  const finalizedRun = { id: 'run-1', status: 'finalized', pay_period: { id: 'P1' } };

  it('a roster-scoped caller filters the exported lines to their reps', async () => {
    const { service, prisma } = make({ runStatus: 'finalized', scopeRepIds: ['rep-1', 'rep-2'] });
    prisma.payRun.findUnique.mockResolvedValue(finalizedRun);
    prisma.payRunLine.findMany.mockResolvedValue([]);
    await service.exportRun('run-1', { format: 'csv' }, user);
    const where = (prisma.payRunLine.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ pay_run_id: 'run-1', rep_id: { in: ['rep-1', 'rep-2'] } });
  });

  it('an all-scope caller (admin/SA) exports every line (no rep_id filter)', async () => {
    const { service, prisma } = make({ runStatus: 'finalized' });
    prisma.payRun.findUnique.mockResolvedValue(finalizedRun);
    prisma.payRunLine.findMany.mockResolvedValue([]);
    await service.exportRun('run-1', { format: 'csv' }, user);
    const where = (prisma.payRunLine.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ pay_run_id: 'run-1' });
  });

  // Production run #10 exported "2019.5" / "406" — Decimal#toString drops trailing zeros.
  it('writes every amount with exactly 2 decimals', async () => {
    const { service, prisma } = make({ runStatus: 'finalized' });
    prisma.payRun.findUnique.mockResolvedValue(finalizedRun);
    const P = (v: string) => new Prisma.Decimal(v);
    prisma.payRunLine.findMany.mockResolvedValue([
      {
        rep: { rep_code: 'RW-D-0002', full_name: 'Sam Stone' },
        commission: P('2019.50'),
        expense_total: P('0.00'),
        incentive_total: P('0'),
        bonus_amount: P('0'),
        clawback_total: P('0'),
        net_payout: P('2019.50'),
      },
    ]);
    const res = await service.exportRun('run-1', { format: 'csv' }, user);
    expect(res.content.split('\n')[0]).toBe('rep_code,rep_name,commission,expense_total,incentive_total,bonus_amount,clawback_total,net_payout');
    expect(res.content.split('\n')[1]).toBe('RW-D-0002,Sam Stone,2019.50,0.00,0.00,0.00,0.00,2019.50');
  });

  it('quotes a value containing a comma so the columns cannot shift', async () => {
    const { service, prisma } = make({ runStatus: 'finalized' });
    prisma.payRun.findUnique.mockResolvedValue(finalizedRun);
    const P = (v: string) => new Prisma.Decimal(v);
    const z = P('0');
    prisma.payRunLine.findMany.mockResolvedValue([
      {
        rep: { rep_code: 'RW-D-0004', full_name: 'Lee, "JJ" Jordan' },
        commission: P('721'), expense_total: z, incentive_total: z,
        bonus_amount: z, clawback_total: z, net_payout: P('721'),
      },
    ]);
    const res = await service.exportRun('run-1', { format: 'csv' }, user);
    expect(res.content.split('\n')[1]).toBe('RW-D-0004,"Lee, ""JJ"" Jordan",721.00,0.00,0.00,0.00,0.00,721.00');
  });
});

