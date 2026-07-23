/**
 * The price chart is a SELECTION projection — it must never do money arithmetic, and it must surface an
 * unpriced product (the exact condition that makes a statement 422). — CLAUDE #1
 */
import { describe, expect, it } from 'vitest';
import { buildPriceChart, unpricedRows } from './priceChart';
import type { BillingRate, Product } from './clients.types';

const label = (k: string) => k.replace(/_/g, ' ');

const product = (id: string, name: string, type = 'internet') =>
  ({ id, name, product_type: type }) as Product;

const rate = (o: Partial<BillingRate> & { id: string; status: BillingRate['status']; amount: string }) =>
  ({
    client_id: 'c1',
    product_id: null,
    rate_kind: 'product',
    bundle_product_types: [],
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    created_by: 'u1',
    ...o,
  }) as BillingRate;

describe('buildPriceChart', () => {
  it('pairs each product with its current rate and its next change', () => {
    const rows = buildPriceChart(
      [product('p1', 'Internet 1Gbps')],
      [
        rate({ id: 'r1', product_id: 'p1', status: 'current', amount: '50.00' }),
        rate({ id: 'r2', product_id: 'p1', status: 'pending', amount: '60.00' }),
        rate({ id: 'r0', product_id: 'p1', status: 'past', amount: '40.00' }),
      ],
      label,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Internet 1Gbps');
    // Amounts pass through as the server's decimal strings — never reformatted or summed here (#1).
    expect(rows[0].current?.amount).toBe('50.00');
    expect(rows[0].pending?.amount).toBe('60.00');
  });

  it('keeps a product with NO rate visible and flags it as unpriced', () => {
    const rows = buildPriceChart([product('p1', 'Internet 1Gbps'), product('p2', 'TV', 'tv')], [
      rate({ id: 'r1', product_id: 'p1', status: 'current', amount: '50.00' }),
    ], label);

    expect(rows).toHaveLength(2);
    expect(unpricedRows(rows).map((r) => r.label)).toEqual(['TV']);
  });

  it('groups client-wide rates by kind, and each bundle by its own trigger set', () => {
    const rows = buildPriceChart(
      [],
      [
        rate({ id: 'b1', rate_kind: 'bundle_bonus', bundle_product_types: ['home_phone', 'tv'], status: 'current', amount: '35.00' }),
        rate({ id: 'b2', rate_kind: 'bundle_bonus', bundle_product_types: ['internet', 'tv'], status: 'current', amount: '20.00' }),
        rate({ id: 's1', rate_kind: 'spiff', status: 'current', amount: '10.00' }),
      ],
      label,
    );

    // Distinct triggers are distinct rows — they are distinct effective-dated scopes server-side.
    expect(rows.map((r) => r.label)).toEqual(['home phone + tv', 'internet + tv', 'Spiff']);
    expect(unpricedRows(rows)).toHaveLength(0); // "unpriced" is a PRODUCT condition only
  });
});
