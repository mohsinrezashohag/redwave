import { describe, expect, it } from 'vitest';
import { validateFormItem } from './validation';
import type { FieldConfig } from './expenses.types';

const meals: FieldConfig = {
  id: 'c1',
  category_key: 'meals',
  label: 'Meals',
  behaviour: 'standard', // mileage follows BEHAVIOUR, not the key — packet 10
  is_system: true,
  requires_receipt: true,
  requires_description: true,
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
    expect(alerts.map((a) => a.field).sort()).toEqual(['amount', 'description', 'receipt_url', 'vendor']);
  });

  it('no alerts when required present', () => {
    const { alerts } = validateFormItem({ category: 'meals', amount: '25.00', description: 'Lunch', receipt_url: 'r', field_values: { vendor: 'X' } }, meals);
    expect(alerts).toHaveLength(0);
  });

  it('warns (not alerts) over the amount soft cap — exact cents, no float', () => {
    const { alerts, warnings } = validateFormItem({ category: 'meals', amount: '30.01', description: 'Lunch', receipt_url: 'r', field_values: { vendor: 'X' } }, meals);
    expect(alerts).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain('amount_over_cap');
    // exactly at the cap → no warning
    expect(validateFormItem({ category: 'meals', amount: '30.00', description: 'Lunch', receipt_url: 'r', field_values: { vendor: 'X' } }, meals).warnings).toHaveLength(0);
  });

  it('warns on a field over its own soft cap', () => {
    const { warnings } = validateFormItem({ category: 'meals', amount: '10.00', description: 'Lunch', receipt_url: 'r', field_values: { vendor: 'X', gratuity: '25.00' } }, meals);
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
    requires_description: false,
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

// A category may declare that its items speak for themselves — a home-made meal has no receipt and nothing
// useful to say beyond "Meals". Both relaxations are CONFIG, never hard-coded against a category key.
describe('a category that requires neither a receipt nor a description', () => {
  const relaxed: FieldConfig = { ...meals, requires_receipt: false, requires_description: false, fields: [] };

  it('saves with no receipt and no description', () => {
    const { alerts } = validateFormItem({ category: 'meals', amount: '12.00' }, relaxed);
    expect(alerts).toHaveLength(0);
  });

  it('still alerts on the amount — relaxing the prose never relaxes the money (#1)', () => {
    const { alerts } = validateFormItem({ category: 'meals' }, relaxed);
    expect(alerts.map((a) => a.field)).toEqual(['amount']);
  });

  it('still applies the soft cap, so a warning is unaffected', () => {
    const { warnings } = validateFormItem({ category: 'meals', amount: '45.00' }, relaxed);
    expect(warnings.map((w) => w.code)).toContain('amount_over_cap');
  });

  it('absent config is treated as REQUIRED, so an unconfigured category never stops asking', () => {
    const { alerts } = validateFormItem({ category: 'other', amount: '5.00' }, undefined);
    expect(alerts.map((a) => a.field)).toContain('description');
  });
});

// This mirror must agree with the server (validation.logic.ts) on what counts as mileage: the category's
// BEHAVIOUR, never its name. A drift here shows the user alerts the server would not raise, or hides ones
// it will. — packet 10
describe('validateFormItem — mileage is decided by behaviour, not the category key', () => {
  const mileage: FieldConfig = { ...meals, category_key: 'mileage', label: 'Mileage', behaviour: 'km', requires_receipt: true, amount_soft_cap: null, fields: [] };
  const kmNamedStandard: FieldConfig = { ...meals, category_key: 'km', label: 'Km', behaviour: 'standard', amount_soft_cap: null, fields: [] };

  it('a km-BEHAVIOUR category needs no amount, receipt or description — whatever it is called', () => {
    const { alerts } = validateFormItem({ category: 'mileage' }, mileage);
    expect(alerts).toHaveLength(0);
  });

  it('a category NAMED km with standard behaviour is an ordinary item and still demands an amount', () => {
    const { alerts } = validateFormItem({ category: 'km' }, kmNamedStandard);
    expect(alerts.map((a) => a.field)).toContain('amount');
  });

  it('falls back to the key only when no config resolved (the server rejects that case anyway)', () => {
    const { alerts } = validateFormItem({ category: 'km' }, undefined);
    expect(alerts.map((a) => a.field)).not.toContain('amount');
  });
});
