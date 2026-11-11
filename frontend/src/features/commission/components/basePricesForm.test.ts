import { describe, expect, it } from 'vitest';
import { basePricesSchema, priceRows, toBasePricesBody, type BasePricesForm } from './basePricesForm';
import type { TierRate } from '../commission.types';

const form = (over: Partial<BasePricesForm> = {}): BasePricesForm => ({
  effective_from: '2026-11-22',
  effective_to: '',
  default_rate: '145.00',
  prices: [
    { product_id: 'gig', name: 'Fibre 1gig', amount: '160.00' },
    { product_id: '500', name: 'Fibre 500', amount: '' },
  ],
  ...over,
});

describe('base prices form', () => {
  it('lists only active internet products, pre-filled from their current tier-1 price', () => {
    const rows = priceRows(
      [
        { id: 'gig', name: 'Fibre 1gig', product_type: 'internet' },
        { id: 'tv', name: 'TV', product_type: 'tv' },
        { id: 'old', name: 'Old', product_type: 'internet', is_active: false },
      ],
      [{ product_id: 'gig', tier_number: 1, amount: '160.00' } as TierRate],
    );
    expect(rows).toEqual([{ product_id: 'gig', name: 'Fibre 1gig', amount: '160.00' }]);
  });

  it('a blank product price is NOT sent — it uses the default', () => {
    expect(toBasePricesBody(form(), 'client-1').prices).toEqual([{ product_id: 'gig', amount: '160.00' }]);
  });

  it('Global sends the default only, never product prices', () => {
    const body = toBasePricesBody(form(), undefined);
    expect(body.client_id).toBeUndefined();
    expect(body.prices).toEqual([]);
  });

  it('validates money as text, never a float', () => {
    expect(basePricesSchema.safeParse(form({ default_rate: 'abc' })).success).toBe(false);
    expect(basePricesSchema.safeParse(form({ prices: [{ product_id: 'x', name: 'x', amount: '1.234' }] })).success).toBe(false);
    expect(basePricesSchema.safeParse(form()).success).toBe(true);
  });
});
