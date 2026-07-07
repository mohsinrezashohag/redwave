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
