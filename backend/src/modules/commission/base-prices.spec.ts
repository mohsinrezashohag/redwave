/**
 * Base prices ("tiers off") — client request 2026-11-11.
 *   - the pure end-plan never rewrites a closed period (#10);
 *   - a scope switch is ONE bracket [0, ∞) + tier-1 product prices, validated before anything is written;
 *   - global takes a default only (a global product price would override every client's ladder);
 *   - products left on the default lose their old tier-1 price; switching tiers back ON ends the prices.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { isBasePriceSchedule, planEndRows } from './base-prices.logic';
import { BasePricesService, endTierRatesWithinTx } from './base-prices.service';
import { validateTierBrackets } from './tier-schedule.logic';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('planEndRows — end without a replacement row', () => {
  it('deletes pending, bounds current to the day before, leaves past untouched', () => {
    const plan = planEndRows(
      [
        { id: 'past', effective_from: d('2026-01-01'), effective_to: d('2026-06-30') },
        { id: 'current', effective_from: d('2026-07-01'), effective_to: null },
        { id: 'pending', effective_from: d('2026-12-01'), effective_to: null },
      ],
      d('2026-11-22'),
    );
    expect(plan.deleteIds).toEqual(['pending']);
    expect(plan.bound).toEqual([{ id: 'current', effectiveTo: d('2026-11-21') }]);
  });
});

describe('isBasePriceSchedule', () => {
  it('true only for a single bracket covering every count', () => {
    expect(isBasePriceSchedule([{ min_count: 0, max_count: null }])).toBe(true);
    expect(isBasePriceSchedule([{ min_count: 0, max_count: 6 }, { min_count: 7, max_count: null }])).toBe(false);
  });
  it('the single bracket is a VALID schedule (passes the shared contiguity check)', () => {
    expect(() => validateTierBrackets([{ tier_number: 1, min_count: 0, max_count: null }])).not.toThrow();
  });
});

const CLIENT = '11111111-1111-4111-8111-111111111111';
const GIG = '22222222-2222-4222-8222-222222222222';
const TV = '33333333-3333-4333-8333-333333333333';
const FUTURE = '2099-01-01';

function make(products: unknown[] = []) {
  const tx = {
    commissionTierConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cfg-new',
        ...data,
        tiers: (data.tiers as { create: unknown[] }).create,
      })),
    },
    commissionTier: { deleteMany: jest.fn() },
    commissionTierRate: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `rate-${data.product_id}`, ...data })),
    },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: CLIENT, is_active: true }) },
    product: { findMany: jest.fn().mockResolvedValue(products) },
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn() };
  return { service: new BasePricesService(prisma as never, audit as never), prisma, tx, audit };
}

const gig = { id: GIG, name: 'Fibre 1gig', client_id: CLIENT, product_type_ref: { behaviour: 'tiered' } };

describe('BasePricesService.setBasePrices', () => {
  it('writes ONE [0,∞) tier-1 bracket at the default + a tier-1 price per product, in one transaction', async () => {
    const { service, tx, audit } = make([gig]);
    await service.setBasePrices(
      { client_id: CLIENT, effective_from: FUTURE, default_rate: '140.00', prices: [{ product_id: GIG, amount: '160.00' }] },
      'sa',
    );
    const schedule = tx.commissionTierConfig.create.mock.calls[0][0].data;
    expect(schedule.client_id).toBe(CLIENT);
    expect(schedule.tiers.create).toEqual([{ tier_number: 1, min_count: 0, max_count: null, rate_per_activation: '140.00' }]);
    expect(tx.commissionTierRate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ client_id: CLIENT, product_id: GIG, tier_number: 1, amount: '160.00' }),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'set_base_prices' }));
  });

  it('ends the old tier-1 price of a product now left on the default (bounded, not deleted)', async () => {
    const { service, tx } = make([gig]);
    tx.commissionTierRate.findMany.mockImplementation(async ({ where }: { where: { product_id?: unknown } }) =>
      // the call from endTierRatesWithinTx (product_id: notIn [GIG]) sees an old current price
      where.product_id && typeof where.product_id === 'object'
        ? [{ id: 'old-500', effective_from: d('2026-01-01'), effective_to: null }]
        : [],
    );
    await service.setBasePrices(
      { client_id: CLIENT, effective_from: FUTURE, default_rate: '140.00', prices: [{ product_id: GIG, amount: '160.00' }] },
      'sa',
    );
    expect(tx.commissionTierRate.update).toHaveBeenCalledWith({ where: { id: 'old-500' }, data: { effective_to: d('2098-12-31') } });
  });

  it('GLOBAL takes a default only — a product price there would override every client’s ladder', async () => {
    const { service, prisma } = make([gig]);
    await expect(
      service.setBasePrices({ effective_from: FUTURE, default_rate: '140.00', prices: [{ product_id: GIG, amount: '160.00' }] }, 'sa'),
    ).rejects.toThrow(/default price only/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses another client’s product, a non-internet product, a duplicate — before writing anything', async () => {
    const other = { ...gig, client_id: 'someone-else' };
    const tv = { id: TV, name: 'TV', client_id: CLIENT, product_type_ref: { behaviour: 'standard_addon' } };
    for (const [products, prices] of [
      [[other], [{ product_id: GIG, amount: '1.00' }]],
      [[tv], [{ product_id: TV, amount: '1.00' }]],
      [[gig], [{ product_id: GIG, amount: '1.00' }, { product_id: GIG, amount: '2.00' }]],
    ] as const) {
      const { service, prisma } = make([...products]);
      await expect(
        service.setBasePrices({ client_id: CLIENT, effective_from: FUTURE, default_rate: '1.00', prices: [...prices] }, 'sa'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('back-dating is refused (#10)', async () => {
    const { service } = make([gig]);
    await expect(
      service.setBasePrices({ client_id: CLIENT, effective_from: '2020-01-01', default_rate: '1.00', prices: [] }, 'sa'),
    ).rejects.toThrow();
  });
});

describe('endTierRatesWithinTx — switching tiers back ON', () => {
  it("ends the scope's tier-1 prices from the new schedule's start", async () => {
    const { tx } = make();
    tx.commissionTierRate.findMany.mockResolvedValue([
      { id: 'cur', effective_from: d('2026-01-01'), effective_to: null },
      { id: 'pend', effective_from: d('2099-02-01'), effective_to: null },
    ]);
    const ids = await endTierRatesWithinTx(tx as never, CLIENT, d(FUTURE));
    expect(tx.commissionTierRate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { client_id: CLIENT, tier_number: 1 } }));
    expect(tx.commissionTierRate.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['pend'] } } });
    expect(tx.commissionTierRate.update).toHaveBeenCalledWith({ where: { id: 'cur' }, data: { effective_to: d('2098-12-31') } });
    expect(ids.sort()).toEqual(['cur', 'pend']);
  });
});
