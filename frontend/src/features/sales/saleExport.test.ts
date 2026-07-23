import { describe, expect, it } from 'vitest';
import { toSaleExportRow } from './saleExport';
import type { Sale, SaleItem } from './sales.types';

const BEHAVIOURS = new Map([
  ['internet', 'tiered'],
  ['greenfield_internet', 'greenfield'],
  ['tv', 'standard_addon'],
  ['home_phone', 'standard_addon'],
  ['protection_plan', 'standard_addon'],
]);

const item = (product_type: string, name: string, rate_applied: string | null): SaleItem =>
  ({
    id: `i-${product_type}`,
    sale_id: 's1',
    product_id: `p-${product_type}`,
    product: { name },
    product_type,
    counts_toward_tally: product_type === 'internet',
    item_status: 'active',
    tier_at_payment: null,
    rate_applied,
    commission_paid: rate_applied,
    incentive_id: null,
    incentive_amount: null,
  }) as SaleItem;

const sale = (items: SaleItem[]): Sale => ({ id: 's1', sale_items: items }) as Sale;

describe('toSaleExportRow — the bill’s component shape, from the frozen commission snapshot', () => {
  it('splits a paid 3-product sale into flags + per-component amounts + a total', () => {
    const row = toSaleExportRow(
      sale([
        item('internet', 'Fibre 1gig/2.5gig', '145.00'),
        item('tv', 'TV', '30.00'),
        item('home_phone', 'Home Phone', '30.00'),
      ]),
      BEHAVIOURS,
    );

    expect(row.product_name).toBe('Fibre 1gig/2.5gig'); // the SPEED, not the add-ons
    expect([row.has_internet, row.has_tv, row.has_home_phone]).toEqual([true, true, true]);
    expect(row.internet_rate).toBe('145.00');
    expect(row.tv_rate).toBe('30.00');
    expect(row.hp_rate).toBe('30.00');
    expect(row.total).toBe('205.00');
  });

  it('leaves the amounts BLANK on an unpaid sale — an entered sale has earned nothing yet, not $0', () => {
    const row = toSaleExportRow(
      sale([item('internet', 'Fibre 1gig/2.5gig', null), item('tv', 'TV', null)]),
      BEHAVIOURS,
    );

    expect([row.has_internet, row.has_tv]).toEqual([true, true]); // presence is still known
    expect(row.internet_rate).toBe('');
    expect(row.tv_rate).toBe('');
    expect(row.total).toBe('');
  });

  it('flags a component with no rate while still totalling the ones that have one', () => {
    const row = toSaleExportRow(
      sale([item('internet', 'Fibre 1gig/2.5gig', '145.00'), item('tv', 'TV', null)]),
      BEHAVIOURS,
    );
    expect(row.has_tv).toBe(true);
    expect(row.tv_rate).toBe('');
    expect(row.total).toBe('145.00');
  });

  it('rolls a product with no column of its own into other_total — never dropped', () => {
    const row = toSaleExportRow(
      sale([item('internet', 'Fibre 1gig/2.5gig', '145.00'), item('protection_plan', 'Protection Plan', '10.00')]),
      BEHAVIOURS,
    );
    expect(row.other_total).toBe('10.00');
    expect(row.has_tv).toBe(false);
    expect(row.total).toBe('155.00');
  });

  it('counts GREENFIELD internet as internet for the flag and the Product column', () => {
    const row = toSaleExportRow(sale([item('greenfield_internet', 'Greenfield Fibre', '100.00')]), BEHAVIOURS);
    expect(row.has_internet).toBe(true);
    expect(row.product_name).toBe('Greenfield Fibre');
    expect(row.internet_rate).toBe('100.00');
  });

  it('treats an UNKNOWN product type as an add-on, never as internet', () => {
    const row = toSaleExportRow(
      sale([item('internet', 'Fibre', '145.00'), item('mystery_type', 'Mystery', '5.00')]),
      BEHAVIOURS,
    );
    expect(row.other_total).toBe('5.00');
    expect(row.product_name).toBe('Fibre'); // the unknown type never claims the Product column
  });

  it('adds exactly — no float drift on repeating cents', () => {
    const row = toSaleExportRow(
      sale([
        item('internet', 'Fibre', '0.10'),
        item('tv', 'TV', '0.20'),
        item('home_phone', 'HP', '0.01'),
      ]),
      BEHAVIOURS,
    );
    expect(row.total).toBe('0.31'); // 0.1 + 0.2 + 0.01 in floats would be 0.30000000000000004
  });

  it('sums two items of the same component onto one column', () => {
    const row = toSaleExportRow(
      sale([item('internet', 'Fibre 500', '145.00'), { ...item('internet', 'Fibre 1gig', '145.00'), id: 'i2' }]),
      BEHAVIOURS,
    );
    expect(row.internet_rate).toBe('290.00');
    expect(row.product_name).toBe('Fibre 500'); // first internet item names the row
  });

  it('a sale with no items yields flags off and blank amounts', () => {
    const row = toSaleExportRow(sale([]), BEHAVIOURS);
    expect([row.has_internet, row.has_tv, row.has_home_phone]).toEqual([false, false, false]);
    expect(row.total).toBe('');
    expect(row.product_name).toBe('');
  });
});
