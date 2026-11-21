import { describe, expect, it } from 'vitest';
import { hasRoundTrip } from './useRoundTripConfirm';
import type { FieldConfig } from '../expenses.types';
import type { ItemValue } from './expenseForm.schema';

const cfg = (category_key: string, behaviour: 'km' | 'standard'): FieldConfig =>
  ({ id: category_key, category_key, label: category_key, behaviour, is_system: true, requires_receipt: behaviour !== 'km', requires_description: true, is_active: true, amount_soft_cap: null, created_by: 'sa', fields: [] }) as FieldConfig;
const configs = [cfg('km', 'km'), cfg('meals', 'standard'), cfg('mileage', 'km')];
const it_ = (over: Partial<ItemValue>): ItemValue => ({ category: 'km', expense_date: '2026-11-16', ...over });

describe('hasRoundTrip (round-trip confirm, meeting 2026-11-16)', () => {
  it('asks for a round km trip', () => {
    expect(hasRoundTrip({ items: [it_({ trip_type: 'round' })] }, configs)).toBe(true);
  });
  it('does not ask for a single trip', () => {
    expect(hasRoundTrip({ items: [it_({ trip_type: 'single' })] }, configs)).toBe(false);
  });
  it('follows the category BEHAVIOUR, not its key', () => {
    expect(hasRoundTrip({ items: [it_({ category: 'mileage', trip_type: 'round' })] }, configs)).toBe(true);
    // A lingering trip_type on a non-km item never prompts.
    expect(hasRoundTrip({ items: [it_({ category: 'meals', trip_type: 'round' })] }, configs)).toBe(false);
  });
});
