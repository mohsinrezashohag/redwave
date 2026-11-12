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

// A crafted engine result for one rep with a single internet activation, paid in full (no holdback since
// 2026-11-13: the config provider always hands the engine a 100% advance).
const ENGINE_RESULT = {
  internetTally: 1,
  tierNumber: 4,
  ratePerActivation: new Decimal('110'),
  items: [
    {
      id: 'item-1',
      productType: 'internet',
      countsTowardTally: true,
      tierAtPayment: 4,
      rateApplied: new Decimal('110'),
      commissionBase: new Decimal('110'),
      incentiveId: null,
      incentiveAmount: new Decimal('0'),
      commissionPaid: new Decimal('110'),
    },
  ],
  grossCommission: new Decimal('110'),
  advanceAmount: new Decimal('110'),
  holdbackAmount: new Decimal('0'),
  incentiveTotal: new Decimal('0'),
  totalEarned: new Decimal('110'),
};

const decLike = (s: string) => ({ toString: () => s });

function make(opts: { runStatus?: string; dueHolds?: unknown[]; bonuses?: unknown[]; clawbackTotal?: string; scopeRepIds?: string[] } = {}) {
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
    // A hold still waiting from the 70/30 era. Finalize must never read or touch the ledger any more.
    holdbackLedger: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue(opts.dueHolds ?? []),
      update: jest.fn(),
    },
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
  // The engine is mocked; the provider always gives a 100% advance (NO_HOLDBACK).
  const config = {
    getEngineConfig: jest.fn().mockResolvedValue({ holdback: { advancePct: new Decimal('1') } }),
    getHoldbackSplit: jest.fn().mockResolvedValue({ advance_pct: '0.7000', holdback_pct: '0.3000' }),
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

describe('PayRunService.finalize — no holdback (client decision 2026-11-13)', () => {
  it('FREEZES snapshots, transitions sales to Paid, pays in full and writes NO holdback row (atomic)', async () => {
    const { service, tx } = make();
    await service.finalize('run-1', user);

    // (#2) immutable snapshot frozen onto the sale_item
    expect(tx.saleItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({ tier_at_payment: 4, rate_applied: '110.00', commission_paid: '110.00' }),
      }),
    );
    // §16: validated → in_pay_run → paid
    expect(tx.sale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'in_pay_run' }) }),
    );
    expect(tx.sale.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'paid' } }));
    // Nothing is held: the ledger is never written.
    expect(tx.holdbackLedger.create).not.toHaveBeenCalled();
    expect(lineArg(tx).commission_70).toBe('110.00');
    expect(lineArg(tx).amount_held).toBe('0.00');
    expect(lineArg(tx).holdback_release_30).toBe('0.00');
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

  it('NEVER releases an old hold still waiting: it is settled offline, not paid by the system', async () => {
    const { service, tx } = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }] });
    await service.finalize('run-1', user);
    expect(tx.holdbackLedger.findMany).not.toHaveBeenCalled();
    expect(tx.holdbackLedger.update).not.toHaveBeenCalled();
    expect(lineArg(tx).holdback_release_30).toBe('0.00');
    expect(lineArg(tx).net_payout).toBe('110.00'); // nothing added from the old hold
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

  it('a clawback deducts IN FULL from net (flat, no set-off against any hold) and is marked applied once', async () => {
    const { service, tx, clawbackSeam } = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }], clawbackTotal: '20.00' });
    await service.finalize('run-1', user);
    expect(tx.holdbackLedger.update).not.toHaveBeenCalled();
    expect(lineArg(tx).clawback_total).toBe('20.00');
    expect(lineArg(tx).net_payout).toBe('90.00'); // 110 − 20
    expect((clawbackSeam as { markApplied: jest.Mock }).markApplied).toHaveBeenCalledTimes(1);
  });

  it('the DRAFT preview shows the same net finalize will pay (no projected release)', async () => {
    const draft = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }], clawbackTotal: '20.00' });
    await (draft.service as unknown as { computeDraftLines: (r: string, p: unknown, u: AuthUser) => Promise<void> })
      .computeDraftLines('run-1', draft.period, user);
    const fin = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }], clawbackTotal: '20.00' });
    await fin.service.finalize('run-1', user);
    expect(lineArg(draft.tx).net_payout).toBe(lineArg(fin.tx).net_payout);
    expect(lineArg(draft.tx).holdback_release_30).toBe('0.00');
    expect(draft.tx.holdbackLedger.findMany).not.toHaveBeenCalled();
  });
});

describe('PayRunService.setBonus', () => {
  it('recomputes net on a draft line', async () => {
    const { service, prisma } = make();
    prisma.payRunLine.findFirst.mockResolvedValue({
      id: 'line-1',
      commission_70: decLike('77.00'),
      holdback_release_30: decLike('0.00'),
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
        commission_70: P('2019.50'),
        holdback_release_30: P('0'),
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
        commission_70: P('721'), holdback_release_30: z, expense_total: z, incentive_total: z,
        bonus_amount: z, clawback_total: z, net_payout: P('721'),
      },
    ]);
    const res = await service.exportRun('run-1', { format: 'csv' }, user);
    expect(res.content.split('\n')[1]).toBe('RW-D-0004,"Lee, ""JJ"" Jordan",721.00,0.00,0.00,0.00,0.00,721.00');
  });

  it('an OLD run that released a hold keeps a holdback_release column so its net still adds up', async () => {
    const { service, prisma } = make({ runStatus: 'finalized' });
    prisma.payRun.findUnique.mockResolvedValue(finalizedRun);
    const P = (v: string) => new Prisma.Decimal(v);
    const z = P('0');
    prisma.payRunLine.findMany.mockResolvedValue([
      {
        rep: { rep_code: 'RW-D-0001', full_name: 'Ana' },
        commission_70: P('77'), holdback_release_30: P('33'), expense_total: z, incentive_total: z,
        bonus_amount: z, clawback_total: z, net_payout: P('110'),
      },
    ]);
    const res = await service.exportRun('run-1', { format: 'csv' }, user);
    expect(res.content.split('\n')[0]).toContain('holdback_release');
    expect(res.content.split('\n')[1]).toBe('RW-D-0001,Ana,77.00,33.00,0.00,0.00,0.00,0.00,110.00');
  });
});

describe('PayRunService — the line carries the engine reconciliation facts', () => {
  it('persists gross, tier, tally and rate; nothing is held so the commission is the gross', async () => {
    const { service, tx } = make();
    await service.finalize('run-1', user);
    const line = lineArg(tx) as unknown as Record<string, unknown>;

    expect(line.gross_commission).toBe('110.00');
    expect(line.amount_held).toBe('0.00');
    expect(line.tier_at_payment).toBe(4);
    expect(line.internet_tally).toBe(1);
    expect(line.rate_per_activation).toBe('110.00');
    expect(line.commission_70).toBe(line.gross_commission);
  });
});
