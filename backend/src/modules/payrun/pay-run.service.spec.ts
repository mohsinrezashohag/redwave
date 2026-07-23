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
    holdbackReleaseSetting: {
      findFirst: jest.fn().mockResolvedValue({ release_rule: 'next_cycle_after_30_days' }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = {
    getRepScope: jest
      .fn()
      .mockResolvedValue(opts.scopeRepIds ? { level: 'roster', repIds: opts.scopeRepIds } : { level: 'all' }),
  };
  const config = { getEngineConfig: jest.fn().mockResolvedValue({}) };
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

  it('CLAWBACK SET-OFF: a pending clawback reduces the due release first, then the remainder hits net', async () => {
    // A $33 hold is due; a $20 clawback sets off against it → $13 released, ledger records clawback_applied 20.
    const { service, tx } = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }], clawbackTotal: '20.00' });
    await service.finalize('run-1', user);
    expect(tx.holdbackLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'h0' },
        data: expect.objectContaining({ release_status: 'released', amount_released: '13.00', clawback_applied: '20.00' }),
      }),
    );
    expect(lineArg(tx).holdback_release_30).toBe('13.00'); // 33 − 20 set-off
    expect(lineArg(tx).clawback_total).toBe('0.00'); // fully covered by the set-off → 0 remainder on net
    // net unchanged either way: 77 advance + 13 released − 0 = 90  (== 77 + 33 − 20)
    expect(lineArg(tx).net_payout).toBe('90.00');
  });

  it('CLAWBACK SET-OFF: a clawback larger than the release consumes it all; the remainder deducts from net', async () => {
    const { service, tx } = make({ dueHolds: [{ id: 'h0', amount_held: decLike('33.00') }], clawbackTotal: '50.00' });
    await service.finalize('run-1', user);
    expect(tx.holdbackLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h0' }, data: expect.objectContaining({ amount_released: '0.00', clawback_applied: '33.00' }) }),
    );
    expect(lineArg(tx).holdback_release_30).toBe('0.00'); // fully consumed
    expect(lineArg(tx).clawback_total).toBe('17.00'); // 50 − 33 remainder on net
    expect(lineArg(tx).net_payout).toBe('60.00'); // 77 + 0 − 17  (== 77 + 33 − 50)
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
});

describe('PayRunService — the line carries the engine reconciliation facts', () => {
  it('persists gross, the 30% held, tier, tally and rate so the 70/30 split is provable', async () => {
    const { service, tx } = make();
    await service.finalize('run-1', user);
    const line = lineArg(tx) as unknown as Record<string, unknown>;

    expect(line.gross_commission).toBe('110.00');
    expect(line.amount_held).toBe('33.00');
    expect(line.tier_at_payment).toBe(4);
    expect(line.internet_tally).toBe(1);
    expect(line.rate_per_activation).toBe('110.00');
    // The invariant the UI relies on: gross = advance + held, exactly.
    expect(Number(line.commission_70) + Number(line.amount_held)).toBe(Number(line.gross_commission));
  });
});

describe('PayRunService.getHoldbackSummary', () => {
  const period = (id: string, n: number, payday: string) => ({
    id,
    period_number: n,
    payday: new Date(payday),
    start_date: new Date(payday),
    end_date: new Date(payday),
    status: 'open',
  });
  // The run is on P2; P3 is the next cycle.
  const periods = [
    period('P1', 1, '2026-01-30T00:00:00.000Z'),
    period('P2', 2, '2026-02-13T00:00:00.000Z'),
    period('P3', 3, '2026-02-27T00:00:00.000Z'),
  ];

  function makeSummary(opts: { status?: string; lines?: unknown[]; ledger?: unknown[] } = {}) {
    const prisma = {
      payRun: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'run-1', status: opts.status ?? 'draft', pay_period: periods[1] }),
      },
      payRunLine: { findMany: jest.fn().mockResolvedValue(opts.lines ?? []) },
      holdbackLedger: { findMany: jest.fn().mockResolvedValue(opts.ledger ?? []) },
      payPeriod: { findMany: jest.fn().mockResolvedValue(periods) },
      holdbackReleaseSetting: { findFirst: jest.fn().mockResolvedValue({ release_rule: 'cycles:1' }) },
    };
    const scope = { getRepScope: jest.fn().mockResolvedValue({ level: 'all' }) };
    const service = new PayRunService(
      prisma as never,
      { log: jest.fn() } as never,
      scope as never,
      {} as never,
      {} as never,
      new ZeroExpenseTotalProvider(),
      new ZeroClawbackTotalProvider(),
      { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never,
    );
    return { service, prisma };
  }

  it('DRAFT: projects the held 30% from the lines and the release period from the rule', async () => {
    const { service } = makeSummary({
      status: 'draft',
      lines: [
        { rep_id: 'r1', amount_held: decLike('123.00') },
        { rep_id: 'r2', amount_held: decLike('77.00') },
      ],
      // A prior P1 hold scheduled to mature INTO this period (P2), not yet released.
      ledger: [
        {
          rep_id: 'r1',
          origin_pay_period_id: 'P1',
          amount_held: decLike('50.00'),
          scheduled_release_period_id: 'P2',
          release_status: 'scheduled',
          amount_released: null,
          clawback_applied: null,
        },
      ],
    });
    const s = await service.getHoldbackSummary('run-1', user);

    expect(s.is_projection).toBe(true);
    expect(s.held_this_period).toBe('200.00'); // Σ line amount_held
    expect(s.held_release_period?.period_number).toBe(3); // cycles:1 from P2 → P3
    expect(s.releasing_this_period).toBe('50.00'); // still-scheduled amount maturing into P2
    expect(s.outstanding_total).toBe('50.00');
  });

  it('FINALIZED: reads the held/released figures from the frozen ledger, incl. the clawback set-off', async () => {
    const { service } = makeSummary({
      status: 'finalized',
      lines: [{ rep_id: 'r1', amount_held: decLike('200.00') }],
      ledger: [
        {
          rep_id: 'r1',
          origin_pay_period_id: 'P2', // this period's hold, frozen at finalize
          amount_held: decLike('200.00'),
          scheduled_release_period_id: 'P3',
          release_status: 'scheduled',
          amount_released: null,
          clawback_applied: null,
        },
        {
          rep_id: 'r1',
          origin_pay_period_id: 'P1', // matured into P2 and was paid out, with a set-off
          amount_held: decLike('50.00'),
          scheduled_release_period_id: 'P2',
          release_status: 'released',
          amount_released: decLike('40.00'),
          clawback_applied: decLike('10.00'),
        },
      ],
    });
    const s = await service.getHoldbackSummary('run-1', user);

    expect(s.is_projection).toBe(false);
    expect(s.held_this_period).toBe('200.00'); // from the ledger, not the lines
    expect(s.held_release_period?.period_number).toBe(3); // the frozen FK
    expect(s.releasing_this_period).toBe('40.00'); // actually released
    expect(s.clawback_setoff_this_period).toBe('10.00');
    expect(s.outstanding_total).toBe('200.00'); // the released P1 hold no longer counts

    // by_origin aggregates the ledger per origin period, oldest first.
    expect(s.by_origin.map((o) => o.origin_period?.period_number)).toEqual([1, 2]);
    expect(s.by_origin[0]).toMatchObject({
      amount_held: '50.00',
      release_status: 'released',
      amount_released: '40.00',
      clawback_applied: '10.00',
    });
    expect(s.by_origin[1]).toMatchObject({ amount_held: '200.00', release_status: 'scheduled' });
  });

  it('scopes to the caller’s reps (a roster caller never sees another roster’s holdback)', async () => {
    const { service, prisma } = makeSummary({ status: 'finalized' });
    prisma.payRunLine.findMany.mockResolvedValue([]); // no lines in scope
    const s = await service.getHoldbackSummary('run-1', user);

    // With no reps in scope the ledger is never queried and every figure is zero.
    expect(prisma.holdbackLedger.findMany).not.toHaveBeenCalled();
    expect(s.held_this_period).toBe('0.00');
    expect(s.outstanding_total).toBe('0.00');
    expect(s.by_origin).toEqual([]);
  });
});
