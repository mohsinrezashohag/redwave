/**
 * CommissionConfigProvider → engine, end to end: the stored rep rates (by type / product, global / per
 * client) become the engine's maps, and the engine pays each item its most specific rate. No tiers, no
 * split since 2026-11-13.
 */
import { CommissionConfigProvider } from './commission-config.provider';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { ProductType } from '../engine/engine.types';
import { GENESIS_RATES } from './genesis-rates';

const GENESIS = new Date('2024-01-01T00:00:00.000Z');
const LATER = new Date('2025-06-01T00:00:00.000Z');
// Prisma.Decimal-like value (the provider only calls .toString() then new Decimal(...)).
const dec = (s: string) => ({ toString: () => s });

const typeRate = (product_type: string, amount: string, client_id: string | null = null, from = GENESIS) => ({
  id: `${client_id ?? 'g'}-${product_type}-${amount}`,
  client_id,
  product_type,
  product_id: null,
  amount: dec(amount),
  effective_from: from,
  effective_to: null,
});

/** A mocked Prisma returning EXACTLY the genesis rates the seed writes. */
function seededPrisma(extra: unknown[] = []) {
  return {
    commissionFlatRate: {
      findMany: jest
        .fn()
        .mockResolvedValue([...Object.entries(GENESIS_RATES.rates).map(([t, a]) => typeRate(t, a)), ...extra]),
    },
    incentive: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('CommissionConfigProvider → CommissionEngine (END-TO-END, genesis rates)', () => {
  const engine = new CommissionEngineService();
  let seq = 0;
  const mk = (productType: ProductType, clientId = 'VF', productId: string | null = null) => ({
    id: `i${(seq += 1)}`,
    productType,
    clientId,
    saleDate: '2026-01-10',
    productId,
  });
  const many = (pt: ProductType, n: number, clientId?: string) => Array.from({ length: n }, () => mk(pt, clientId));

  it('20 internet + 4 TV + 3 HP + 2 greenfield → 2610.00, paid in full', async () => {
    const config = await new CommissionConfigProvider(seededPrisma() as never).getEngineConfig('2026-01-10');
    const result = engine.computePeriod({
      activations: [
        ...many(ProductType.internet, 20),
        ...many(ProductType.tv, 4),
        ...many(ProductType.home_phone, 3),
        ...many(ProductType.greenfield_internet, 2),
      ],
      config,
    });
    expect(result.commissionTotal.toFixed(2)).toBe('2610.00');
  });

  it('a product rate and a client rate are the most specific, and greenfield ignores the product rate', async () => {
    const config = await new CommissionConfigProvider(
      seededPrisma([
        { ...typeRate('internet', '150.00'), id: 'p1', product_id: 'fibre1g' },
        typeRate('internet', '125.00', 'RF'),
      ]) as never,
    ).getEngineConfig('2026-01-10');
    const r = engine.computePeriod({
      activations: [
        mk(ProductType.internet, 'VF', 'fibre1g'),
        mk(ProductType.internet, 'RF'),
        mk(ProductType.greenfield_internet, 'VF', 'fibre1g'),
      ],
      config,
    });
    expect(r.items.map((i) => i.rateApplied.toFixed(2))).toEqual(['150.00', '125.00', '100.00']);
  });
});

describe('CommissionConfigProvider — scope grouping', () => {
  it('rates are keyed by (client, product_type): a client’s LATER rate never becomes the global one', async () => {
    const config = await new CommissionConfigProvider(
      seededPrisma([typeRate('tv', '45.00', 'VF', LATER)]) as never,
    ).getEngineConfig('2026-01-10');
    expect(config.flatRates.tv.toFixed(2)).toBe('30.00'); // global untouched
    expect(config.flatRatesByClient?.VF?.tv.toFixed(2)).toBe('45.00');
  });

  it('a product-scoped row never masquerades as its type rate', async () => {
    const config = await new CommissionConfigProvider(
      seededPrisma([{ ...typeRate('tv', '60.00'), id: 'ptv', product_id: 'premium-tv' }]) as never,
    ).getEngineConfig('2026-01-10');
    expect(config.flatRates.tv.toFixed(2)).toBe('30.00');
    expect(config.flatRatesByProduct?.['premium-tv'].toFixed(2)).toBe('60.00');
  });
});
