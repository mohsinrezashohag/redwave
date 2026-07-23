import { describe, expect, it } from 'vitest';
import { groupItems, categoryLabel } from './format';
import type { ExpenseItem, FieldConfig } from './expenses.types';

const item = (over: Partial<ExpenseItem> = {}): ExpenseItem =>
  ({
    id: `i-${Math.random()}`,
    category: 'meals',
    expense_date: '2026-07-08T00:00:00.000Z',
    amount: '20.00',
    is_personal: false,
    ...over,
  }) as ExpenseItem;

const configs = [
  { category_key: 'km', label: 'Kilometres' },
  { category_key: 'meals', label: 'Meals' },
] as unknown as FieldConfig[];

describe('groupItems — the grouping dimension', () => {
  it('groups by CATEGORY, labelled from the config', () => {
    const groups = groupItems(
      [
        item({ category: 'km', amount: '61.74' }),
        item({ category: 'km', amount: '84.38' }),
        item({ category: 'meals', amount: '45.00' }),
      ],
      'category',
      configs,
    );
    expect(groups.map((g) => g.label)).toEqual(['Kilometres', 'Meals']); // alphabetical, not arbitrary
    expect(groups[0]).toMatchObject({ count: 2, total: '146.12' }); // exact decimal, no float drift
    expect(groups[1]).toMatchObject({ count: 1, total: '45.00' });
  });

  it('falls back to a humanized key when the category has no config', () => {
    // 'hotel' is a real category but absent from `configs` — the bucket must still be labelled, not blank.
    const [g] = groupItems([item({ category: 'hotel' })], 'category');
    expect(g.label).toBe('Hotel');
  });

  it('a category bucket EXCLUDES personal items from the total but still counts them (EXP-012)', () => {
    const [g] = groupItems(
      [item({ category: 'meals', amount: '20.00' }), item({ category: 'meals', amount: '99.00', is_personal: true })],
      'category',
      configs,
    );
    expect(g.count).toBe(2);
    expect(g.total).toBe('20.00');
  });

  it('date buckets still sort newest-first (unchanged)', () => {
    const groups = groupItems(
      [item({ expense_date: '2026-07-08T00:00:00.000Z' }), item({ expense_date: '2026-07-16T00:00:00.000Z' })],
      'daily',
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-07-16', '2026-07-08']);
  });
});

describe('categoryLabel', () => {
  it('prefers the configured label, else humanizes the key', () => {
    expect(categoryLabel('km', configs)).toBe('Kilometres');
    expect(categoryLabel('home_office', configs)).toBe('Home Office');
  });
});
