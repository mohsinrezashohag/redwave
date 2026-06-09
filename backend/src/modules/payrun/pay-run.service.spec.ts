import { Decimal } from 'decimal.js';
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

// A crafted engine result for one rep with a single internet activation (advance 77 / hold 33).
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
  advanceAmount: new Decimal('77'),
  holdbackAmount: new Decimal('33'),
  incentiveTotal: new Decimal('0'),
  totalEarned: new Decimal('110'),
};

const decLike = (s: string) => ({ toString: () => s });

function make(opts: { runStatus?: string; dueHolds?: unknown[]; bonuses?: unknown[] } = {}) {
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
    },
    payRunLine: {
      findMany: jest.fn().mockResolvedValue(opts.bonuses ?? []),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    sale: { findMany: jest.fn().mockResolvedValue([{ rep_id: 'rep-1' }]) }, // repsWithValidatedSales (distinct)
    rep: { findMany: jest.fn().mockResolvedValue([{ id: 'rep-1', user_id: null }]) }, // pay_run_finalized recipients
    holdbackReleaseSetting: {
      findFirst: jest.fn().mockResolvedValue({ release_rule: 'next_cycle_after_30_days' }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = { getRepScope: jest.fn().mockResolvedValue({ level: 'all' }) };
  const config = { getEngineConfig: jest.fn().mockResolvedValue({}) };
  const engine = { computePeriod: jest.fn().mockReturnValue(ENGINE_RESULT) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const service = new PayRunService(
    prisma as never,
    audit as never,
    scope as never,
    config as never,
    engine as never,
    new ZeroExpenseTotalProvider(),
    new ZeroClawbackTotalProvider(),
    emitter as never,
  );
  return { service, prisma, tx };
}

const lineArg = (tx: ReturnType<typeof make>['tx']) =>
  (tx.payRunLine.create.mock.calls[0][0] as { data: Record<string, string> }).data;

describe('PayRunService.finalize', () => {
  it('FREEZES snapshots, transitions sales to Paid, records holdback, finalizes (atomic)', async () => {
    const { service, tx } = make();
    await service.finalize('run-1', user);

    // (#2) immutable snapshot frozen onto the sale_item
    expect(tx.saleItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          tier_at_payment: 4,
          rate_applied: '110.00',
          commission_paid: '110.00',
        }),
      }),
    );
    // §16: validated → in_pay_run → paid
    expect(tx.sale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'in_pay_run' }) }),
    );
    expect(tx.sale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'paid' } }),
    );
    // 30% recorded on the holdback ledger
    expect(tx.holdbackLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount_held: '33.00', release_status: 'scheduled' }),
      }),
    );
    // line + run/period status
    expect(lineArg(tx).commission_70).toBe('77.00');
    expect(lineArg(tx).net_payout).toBe('77.00'); // seams 0, no released/bonus
    expect(tx.payRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'finalized' } }),
    );
    expect(tx.payPeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'paid' } }),
    );
  });

  it('is IDEMPOTENT — re-finalizing a finalized run is a no-op (no transaction)', async () => {
    const { service, prisma } = make({ runStatus: 'finalized' });
    await service.finalize('run-1', user);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is ATOMIC — a mid-finalize failure rejects and never marks the run finalized', async () => {
    const { service, tx } = make();
    tx.holdbackLedger.create.mockRejectedValue(new Error('boom'));
    await expect(service.finalize('run-1', user)).rejects.toThrow('boom');
    expect(tx.payRun.update).not.toHaveBeenCalled(); // rolled back; never finalized
  });

  it('RELEASES a due prior hold into net', async () => {
    const { service, tx } = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }] });
    await service.finalize('run-1', user);
    expect(tx.holdbackLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'h0' },
        data: expect.objectContaining({ release_status: 'released', amount_released: '33.00' }),
      }),
    );
    expect(lineArg(tx).holdback_release_30).toBe('33.00');
    expect(lineArg(tx).net_payout).toBe('110.00'); // 77 advance + 33 released
  });

  it('applies a bonus; expense/clawback seams resolve to 0', async () => {
    const { service, tx } = make({
      bonuses: [{ rep_id: 'rep-1', bonus_amount: decLike('50.00'), bonus_note: 'spiff' }],
    });
    await service.finalize('run-1', user);
    expect(lineArg(tx).bonus_amount).toBe('50.00');
    expect(lineArg(tx).expense_total).toBe('0.00');
    expect(lineArg(tx).clawback_total).toBe('0.00');
    expect(lineArg(tx).net_payout).toBe('127.00'); // 77 + 50 bonus
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
