import { CommissionConfigProvider } from './commission-config.provider';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { ProductType } from '../engine/engine.types';
import { SCHEDULE_C_V2 } from './schedule-c-v2';

// Genesis effective date for the seeded config (provider must select it for any later date).
const GENESIS = new Date('2024-01-01T00:00:00.000Z');
// Prisma.Decimal-like value (the provider only calls .toString() then new Decimal(...)).
const dec = (s: string) => ({ toString: () => s });

/** A mocked Prisma returning EXACTLY the Schedule C v2 values the seed writes. */
function seededPrisma() {
  return {
    commissionTierConfig: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'tc1',
          effective_from: GENESIS,
          effective_to: null,
          tiers: SCHEDULE_C_V2.tiers.map((t, i) => ({
            id: `t${i}`,
            tier_number: t.tier_number,
            min_count: t.min_count,
            max_count: t.max_count,
            rate_per_activation: dec(t.rate_per_activation),
          })),
        },
      ]),
    },
    commissionFlatRate: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'f1',
          product_type: 'greenfield_internet',
          amount: dec(SCHEDULE_C_V2.flatRates.greenfield_internet),
          effective_from: GENESIS,
          effective_to: null,
        },
        {
          id: 'f2',
          product_type: 'tv',
          amount: dec(SCHEDULE_C_V2.flatRates.tv),
          effective_from: GENESIS,
          effective_to: null,
        },
        {
          id: 'f3',
          product_type: 'home_phone',
          amount: dec(SCHEDULE_C_V2.flatRates.home_phone),
          effective_from: GENESIS,
          effective_to: null,
        },
      ]),
    },
    holdbackConfig: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'h1',
          advance_pct: dec(SCHEDULE_C_V2.holdback.advance_pct),
          holdback_pct: dec(SCHEDULE_C_V2.holdback.holdback_pct),
          effective_from: GENESIS,
          effective_to: null,
        },
      ]),
    },
    incentive: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('CommissionConfigProvider → CommissionEngine (END-TO-END, seeded Schedule C v2)', () => {
  const engine = new CommissionEngineService();
  let seq = 0;
  const mk = (productType: ProductType, clientId = 'VF') => ({
    id: `i${(seq += 1)}`,
    productType,
    clientId,
    saleDate: '2026-01-10',
  });
  const many = (pt: ProductType, n: number, clientId?: string) =>
    Array.from({ length: n }, () => mk(pt, clientId));

  it('config → provider → engine reproduces the $3,310 case (3310.00 / 2317.00 / 993.00)', async () => {
    const provider = new CommissionConfigProvider(seededPrisma() as never);
    const config = await provider.getEngineConfig('2026-01-10');

    const activations = [
      ...many(ProductType.internet, 20),
      ...many(ProductType.tv, 4),
      ...many(ProductType.home_phone, 3),
      ...many(ProductType.greenfield_internet, 2),
    ];
    const result = engine.computePeriod({ activations, config });

    expect(result.internetTally).toBe(20);
    expect(result.tierNumber).toBe(2); // $145
    expect(result.grossCommission.toFixed(2)).toBe('3310.00');
    expect(result.advanceAmount.toFixed(2)).toBe('2317.00'); // 70%
    expect(result.holdbackAmount.toFixed(2)).toBe('993.00'); // 30%
  });

  it('config → provider → engine reproduces cross-client (3 VF + 9 RF → Tier 3 → 1500.00)', async () => {
    const provider = new CommissionConfigProvider(seededPrisma() as never);
    const config = await provider.getEngineConfig('2026-01-10');

    const activations = [
      ...many(ProductType.internet, 3, 'VF'),
      ...many(ProductType.internet, 9, 'RF'),
    ];
    const result = engine.computePeriod({ activations, config });

    expect(result.internetTally).toBe(12);
    expect(result.tierNumber).toBe(3); // $125
    expect(result.grossCommission.toFixed(2)).toBe('1500.00');
  });
});

describe('CommissionConfigProvider — per-client scope grouping', () => {
  const LATER = new Date('2025-06-01T00:00:00.000Z');
  const bracket = (rate: string) => [
    { id: 'b', tier_number: 1, min_count: 0, max_count: null, rate_per_activation: dec(rate) },
  ];

  /** Global genesis schedule + a LATER client-scoped one (the shape that used to break selection). */
  function scopedPrisma() {
    const prisma = seededPrisma();
    prisma.commissionTierConfig.findMany = jest.fn().mockResolvedValue([
      { id: 'global', client_id: null, effective_from: GENESIS, effective_to: null, tiers: bracket('110.00') },
      { id: 'vf', client_id: 'VF', effective_from: LATER, effective_to: null, tiers: bracket('200.00') },
    ]);
    prisma.commissionFlatRate.findMany = jest.fn().mockResolvedValue([
      { id: 'g', client_id: null, product_type: 'tv', amount: dec('30.00'), effective_from: GENESIS, effective_to: null },
      { id: 'v', client_id: 'VF', product_type: 'tv', amount: dec('45.00'), effective_from: LATER, effective_to: null },
    ]);
    return prisma;
  }

  it('a per-client schedule with a LATER effective_from does NOT become the global one', async () => {
    const config = await new CommissionConfigProvider(scopedPrisma() as never).getEngineConfig('2026-01-10');

    // Selection must group by scope FIRST; ungrouped, VF's newer row would win for everyone.
    expect(config.tiers[0].ratePerActivation.toFixed(2)).toBe('110.00'); // global untouched
    expect(config.tiersByClient?.VF?.[0].ratePerActivation.toFixed(2)).toBe('200.00');
  });

  it('flat rates are keyed by (client, product_type), not collapsed together', async () => {
    const config = await new CommissionConfigProvider(scopedPrisma() as never).getEngineConfig('2026-01-10');

    expect(config.flatRates.tv.toFixed(2)).toBe('30.00'); // global
    expect(config.flatRatesByClient?.VF?.tv.toFixed(2)).toBe('45.00');
  });

  it('still 422s when there is no GLOBAL schedule, even if a client has one', async () => {
    const prisma = seededPrisma();
    prisma.commissionTierConfig.findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'vf', client_id: 'VF', effective_from: GENESIS, effective_to: null, tiers: bracket('200.00') }]);
    await expect(
      new CommissionConfigProvider(prisma as never).getEngineConfig('2026-01-10'),
    ).rejects.toMatchObject({ status: 422 });
  });
});
