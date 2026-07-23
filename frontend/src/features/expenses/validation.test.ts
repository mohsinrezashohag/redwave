import { describe, expect, it } from 'vitest';
import { validateFormItem } from './validation';
import type { FieldConfig } from './expenses.types';

const meals: FieldConfig = {
  id: 'c1',
  category_key: 'meals',
  label: 'Meals',
  requires_receipt: true,
  is_active: true,
  amount_soft_cap: '30.00',
  created_by: 'sa',
  fields: [
    { key: 'vendor', label: 'Vendor', type: 'text', required: true },
    { key: 'gratuity', label: 'Gratuity', type: 'money', required: false, soft_cap: '20.00' },
  ],
};

describe('validateFormItem (FE mirror of the Alert/Warning engine)', () => {
  it('alerts on a missing required field + missing amount/receipt', () => {
    const { alerts } = validateFormItem({ category: 'meals' }, meals);
    expect(alerts.map((a) => a.field).sort()).toEqual(['amount', 'receipt_url', 'vendor']);
  });

  it('no alerts when required present', () => {
    const { alerts } = validateFormItem({ category: 'meals', amount: '25.00', receipt_url: 'r', field_values: { vendor: 'X' } }, meals);
    expect(alerts).toHaveLength(0);
  });

  it('warns (not alerts) over the amount soft cap — exact cents, no float', () => {
    const { alerts, warnings } = validateFormItem({ category: 'meals', amount: '30.01', receipt_url: 'r', field_values: { vendor: 'X' } }, meals);
    expect(alerts).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain('amount_over_cap');
    // exactly at the cap → no warning
    expect(validateFormItem({ category: 'meals', amount: '30.00', receipt_url: 'r', field_values: { vendor: 'X' } }, meals).warnings).toHaveLength(0);
  });

  it('warns on a field over its own soft cap', () => {
    const { warnings } = validateFormItem({ category: 'meals', amount: '10.00', receipt_url: 'r', field_values: { vendor: 'X', gratuity: '25.00' } }, meals);
    expect(warnings.map((w) => w.field)).toContain('gratuity');
  });

  it('warns on a km trip the commute deduction zeroed', () => {
    const { alerts, warnings } = validateFormItem({ category: 'km', billable_km: 0 }, undefined);
    expect(alerts).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toEqual(['km_zero_claim']);
  });
});

/**
 * The cap is PER UNIT when a field declares itself the multiplier — so combining a day's meals into ONE
 * item is judged the same as splitting them, instead of being flagged for it. Mirrors the server engine.
 */
describe('validateFormItem — per-unit soft cap', () => {
  const mealsWithCount = {
    category_key: 'meals',
    label: 'Meals',
    requires_receipt: false,
    is_active: true,
    amount_soft_cap: '30.00',
    fields: [{ key: 'meals_count', label: 'Meals covered', type: 'number', required: false, multiplies_cap: true }],
  } as unknown as FieldConfig;

  it('one item covering 2 meals at $45 does not warn', () => {
    const { warnings } = validateFormItem(
      { category: 'meals', amount: '45.00', field_values: { meals_count: '2' } },
      mealsWithCount,
    );
    expect(warnings).toHaveLength(0);
  });

  it('warns past the SCALED cap and names it', () => {
    const { warnings } = validateFormItem(
      { category: 'meals', amount: '61.00', field_values: { meals_count: '2' } },
      mealsWithCount,
    );
    expect(warnings.map((w) => w.code)).toEqual(['amount_over_cap']);
    expect(warnings[0].message).toContain('60.00');
  });

  it('a blank count never lowers the bar', () => {
    const { warnings } = validateFormItem(
      { category: 'meals', amount: '45.00', field_values: { meals_count: '' } },
      mealsWithCount,
    );
    expect(warnings.map((w) => w.code)).toEqual(['amount_over_cap']);
  });

  it('an untouched optional field (undefined) is treated as blank, never as invalid', () => {
    const { alerts, warnings } = validateFormItem(
      { category: 'meals', amount: '20.00', field_values: { meals_count: undefined } },
      mealsWithCount,
    );
    expect(alerts).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
