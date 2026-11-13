/**
 * Commission Engine — the acceptance fixtures. No tiers and no 70/30 since 2026-11-13: every item pays ONE
 * flat rep rate (most specific wins), greenfield pays the greenfield rate, incentives are separate and paid
 * in full, and a clawback recovers exactly rate + incentive from the snapshot. — CLAUDE §6
 */
import { Decimal } from 'decimal.js';
import { CommissionEngineService } from './commission-engine.service';
import { d } from './money';
import { ActivationInput, EngineConfig, FlatRates, IncentiveConfig, ProductType } from './engine.types';

const { internet, greenfield_internet, tv, home_phone } = ProductType;

// ── Standard config fixture: default rate per product type (the genesis defaults) ─────────────────
const FLAT: FlatRates = { internet: d('110'), greenfield_internet: d('100'), tv: d('30'), home_phone: d('30') };
const baseConfig = (overrides: Partial<EngineConfig> = {}): EngineConfig => ({ flatRates: FLAT, ...overrides });

// ── Activation builders ─────────────────────────────────────────────────────────────────────
let seq = 0;
const mk = (
  productType: ProductType,
  clientId = 'VF',
  saleDate = '2026-01-10',
  productId: string | null = null,
): ActivationInput => ({ id: `item-${(seq += 1)}`, productType, clientId, saleDate, productId });
const mkMany = (productType: ProductType, n: number, clientId?: string, productId: string | null = null) =>
  Array.from({ length: n }, () => mk(productType, clientId, '2026-01-10', productId));

/** Assert a Decimal equals an expected cents string (e.g. '2410.00'). */
const money = (value: Decimal) => value.toFixed(2);

describe('CommissionEngineService — flat rep rates (no tiers, no split)', () => {
  const engine = new CommissionEngineService();

  it('FIXTURE 1 — 20 internet + 4 TV + 3 HP + 2 greenfield, paid in full at the type rates', () => {
    const r = engine.computePeriod({
      activations: [...mkMany(internet, 20), ...mkMany(tv, 4), ...mkMany(home_phone, 3), ...mkMany(greenfield_internet, 2)],
      config: baseConfig(),
    });
    // 20 × 110 + 4 × 30 + 3 × 30 + 2 × 100 = 2200 + 120 + 90 + 200
    expect(money(r.commissionTotal)).toBe('2610.00');
    expect(money(r.incentiveTotal)).toBe('0.00');
    expect(money(r.totalEarned)).toBe('2610.00');
    expect(r.items).toHaveLength(29);
  });

  it('FIXTURE 2 — volume never changes the rate: 1 internet and 40 internet pay the same per unit', () => {
    const one = engine.computePeriod({ activations: mkMany(internet, 1), config: baseConfig() });
    const forty = engine.computePeriod({ activations: mkMany(internet, 40), config: baseConfig() });
    expect(money(one.items[0].rateApplied)).toBe('110.00');
    expect(forty.items.every((i) => money(i.rateApplied) === '110.00')).toBe(true);
    expect(money(forty.commissionTotal)).toBe('4400.00');
  });

  it('FIXTURE 3 — most specific rate wins: client+product → product → client+type → type', () => {
    const config = baseConfig({
      flatRatesByClient: { RF: { internet: d('120') } },
      flatRatesByProduct: { fibre1g: d('150') },
      flatRatesByClientProduct: { RF: { fibre1g: d('175') } },
    });
    const r = engine.computePeriod({
      activations: [
        mk(internet, 'VF', '2026-01-10', null), // type → 110
        mk(internet, 'RF', '2026-01-10', null), // client+type → 120
        mk(internet, 'VF', '2026-01-10', 'fibre1g'), // product → 150
        mk(internet, 'RF', '2026-01-10', 'fibre1g'), // client+product → 175
        mk(internet, 'RF', '2026-01-10', 'fibre500'), // no product rate → client+type 120
      ],
      config,
    });
    expect(r.items.map((i) => money(i.rateApplied))).toEqual(['110.00', '120.00', '150.00', '175.00', '120.00']);
  });

  it('FIXTURE 4 — greenfield pays the GREENFIELD rate, never the internet product’s own rate (#9)', () => {
    const config = baseConfig({
      flatRatesByProduct: { fibre1g: d('150') },
      flatRatesByClientProduct: { RF: { fibre1g: d('175') } },
      flatRatesByClient: { RF: { greenfield_internet: d('90') } },
    });
    const r = engine.computePeriod({
      activations: [mk(greenfield_internet, 'VF', '2026-01-10', 'fibre1g'), mk(greenfield_internet, 'RF', '2026-01-10', 'fibre1g')],
      config,
    });
    expect(r.items.map((i) => money(i.rateApplied))).toEqual(['100.00', '90.00']); // global, then RF's own
  });

  it('FIXTURE 5 — per-product clawback: TV → $30; TV + $20 incentive → $50; other items untouched', () => {
    expect(money(engine.computeClawbackAmount({ rateApplied: d('30') }))).toBe('30.00');
    expect(money(engine.computeClawbackAmount({ rateApplied: d('30'), incentiveAmount: d('20') }))).toBe('50.00');
    expect(money(engine.computeClawbackAmount({ rateApplied: d('30'), incentiveAmount: null }))).toBe('30.00');
  });

  it('a product type with no rate at any level THROWS — a rep is never silently paid $0', () => {
    expect(() =>
      engine.computePeriod({ activations: [mk('wireless' as ProductType)], config: baseConfig() }),
    ).toThrow(/No rep rate for product type wireless/);
  });

  it('an SA-added add-on type is priced by its own key', () => {
    const r = engine.computePeriod({
      activations: [mk('mesh' as ProductType)],
      config: baseConfig({ flatRates: { ...FLAT, mesh: d('15') } }),
    });
    expect(money(r.commissionTotal)).toBe('15.00');
  });

  it('EDGE — zero activations: all totals 0', () => {
    const r = engine.computePeriod({ activations: [], config: baseConfig() });
    expect(r.items).toEqual([]);
    expect(money(r.commissionTotal)).toBe('0.00');
    expect(money(r.totalEarned)).toBe('0.00');
  });

  it('EDGE — per_activation incentive: applied to scope, kept separate from the rate', () => {
    const incentive: IncentiveConfig = {
      id: 'inc-1',
      scopeClientId: null,
      scopeProductType: tv,
      targetType: 'per_activation',
      targetCount: null,
      windowStart: '2026-01-01',
      windowEnd: '2026-01-31',
      amount: d('20'),
    };
    const r = engine.computePeriod({
      activations: [mk(internet), mk(tv)],
      config: baseConfig({ incentives: [incentive] }),
    });
    const tvItem = r.items.find((i) => i.productType === tv)!;
    expect(money(tvItem.incentiveAmount)).toBe('20.00');
    expect(tvItem.incentiveId).toBe('inc-1');
    expect(money(tvItem.commissionBase)).toBe('30.00'); // the rate excludes the incentive
    expect(money(tvItem.commissionPaid)).toBe('50.00'); // snapshot = rate + incentive = the clawback amount
    expect(money(r.items.find((i) => i.productType === internet)!.incentiveAmount)).toBe('0.00');
    expect(money(r.commissionTotal)).toBe('140.00');
    expect(money(r.incentiveTotal)).toBe('20.00');
    expect(money(r.totalEarned)).toBe('160.00');
  });

  it('EDGE — per_activation incentive with a threshold: bonus ONLY beyond target_count', () => {
    const incentive: IncentiveConfig = {
      id: 'inc-pa',
      scopeClientId: null,
      scopeProductType: tv,
      targetType: 'per_activation',
      targetCount: 2,
      windowStart: '2026-01-01',
      windowEnd: '2026-01-31',
      amount: d('20'),
    };
    const activations = [mk(tv, 'VF', '2026-01-10'), mk(tv, 'VF', '2026-01-11'), mk(tv, 'VF', '2026-01-12'), mk(tv, 'VF', '2026-01-13')];
    const r = engine.computePeriod({ activations, config: baseConfig({ incentives: [incentive] }) });
    const ordered = activations.map((a) => r.items.find((i) => i.id === a.id)!);
    expect(ordered.map((i) => money(i.incentiveAmount))).toEqual(['0.00', '0.00', '20.00', '20.00']);
    expect(money(r.incentiveTotal)).toBe('40.00');
    expect(money(r.commissionTotal)).toBe('120.00');
  });

  it('EDGE — one_time incentive: a SINGLE bonus on the threshold-crossing activation, else none', () => {
    const incentive: IncentiveConfig = {
      id: 'inc-ot',
      scopeClientId: null,
      scopeProductType: null,
      targetType: 'one_time',
      targetCount: 3,
      windowStart: '2026-01-01',
      windowEnd: '2026-01-31',
      amount: d('100'),
    };
    const activations = ['10', '11', '12', '13', '14'].map((day) => mk(internet, 'VF', `2026-01-${day}`));
    const r = engine.computePeriod({ activations, config: baseConfig({ incentives: [incentive] }) });
    const ordered = activations.map((a) => r.items.find((i) => i.id === a.id)!);
    expect(money(ordered[2].incentiveAmount)).toBe('100.00');
    expect(money(r.incentiveTotal)).toBe('100.00');

    const short = engine.computePeriod({ activations: activations.slice(0, 2), config: baseConfig({ incentives: [incentive] }) });
    expect(money(short.incentiveTotal)).toBe('0.00');
  });

  it('EDGE — incentive does NOT apply outside its window or scope', () => {
    const outOfWindow: IncentiveConfig = {
      id: 'inc-w',
      scopeClientId: null,
      scopeProductType: tv,
      targetType: 'per_activation',
      targetCount: null,
      windowStart: '2026-02-01',
      windowEnd: '2026-02-28',
      amount: d('20'),
    };
    const r1 = engine.computePeriod({ activations: [mk(tv)], config: baseConfig({ incentives: [outOfWindow] }) });
    expect(money(r1.items[0].incentiveAmount)).toBe('0.00');
    const wrongClient: IncentiveConfig = { ...outOfWindow, id: 'inc-c', scopeClientId: 'RF', windowStart: '2026-01-01', windowEnd: '2026-01-31' };
    const r2 = engine.computePeriod({ activations: [mk(tv, 'VF')], config: baseConfig({ incentives: [wrongClient] }) });
    expect(money(r2.items[0].incentiveAmount)).toBe('0.00');
  });
});
