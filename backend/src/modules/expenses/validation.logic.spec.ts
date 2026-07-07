import { CategorySchema } from './field-schema.logic';
import { validateExpenseItem, ValidatableItem } from './validation.logic';

const mealsSchema = (over: Partial<CategorySchema> = {}): CategorySchema => ({
  category_key: 'meals',
  requires_receipt: true,
  is_active: true,
  amount_soft_cap: '30.00',
  fields: [
    { key: 'vendor', label: 'Vendor', type: 'text', required: true },
    { key: 'city', label: 'City', type: 'text', required: false },
    { key: 'gratuity', label: 'Gratuity', type: 'money', required: false, soft_cap: '20.00' },
  ],
  ...over,
});

const item = (over: Partial<ValidatableItem> = {}): ValidatableItem => ({
  category: 'meals',
  amount: '25.00',
  receipt_url: 'receipts/2026/01/x.jpg',
  field_values: { vendor: 'Tim Hortons' },
  ...over,
});

describe('validateExpenseItem — Alerts (block save)', () => {
  it('flags a missing required field as an alert', () => {
    const { alerts } = validateExpenseItem(item({ field_values: { city: 'Winnipeg' } }), mealsSchema());
    expect(alerts.map((a) => a.field)).toContain('vendor');
    expect(alerts.find((a) => a.field === 'vendor')?.severity).toBe('alert');
  });

  it('flags a missing amount + missing receipt as alerts (vendor present)', () => {
    const { alerts } = validateExpenseItem(item({ amount: '', receipt_url: null }), mealsSchema());
    expect(alerts.map((a) => a.field).sort()).toEqual(['amount', 'receipt_url']);
  });

  it('no alerts when all required present + receipt attached', () => {
    const { alerts } = validateExpenseItem(item(), mealsSchema());
    expect(alerts).toHaveLength(0);
  });

  it('an optional field missing is NOT an alert', () => {
    const { alerts } = validateExpenseItem(item({ field_values: { vendor: 'X' } }), mealsSchema());
    expect(alerts).toHaveLength(0); // city is optional
  });
});

describe('validateExpenseItem — Warnings (flag, non-blocking)', () => {
  it('warns when the amount exceeds the category soft cap', () => {
    const { alerts, warnings } = validateExpenseItem(item({ amount: '45.00' }), mealsSchema());
    expect(alerts).toHaveLength(0); // over-cap never blocks
    expect(warnings.map((w) => w.code)).toContain('amount_over_cap');
  });

  it('does NOT warn at or below the soft cap', () => {
    expect(validateExpenseItem(item({ amount: '30.00' }), mealsSchema()).warnings).toHaveLength(0);
  });

  it('warns when a field value exceeds its own soft cap', () => {
    const { warnings } = validateExpenseItem(item({ field_values: { vendor: 'X', gratuity: '25.00' } }), mealsSchema());
    expect(warnings.map((w) => w.field)).toContain('gratuity');
  });

  it('warns on a km trip the commute deduction zeroed ($0 claim)', () => {
    const { alerts, warnings } = validateExpenseItem({ category: 'km', amount: '0.00', km: { billable_km: '0' } }, undefined);
    expect(alerts).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toEqual(['km_zero_claim']);
  });

  it('does NOT warn on a km trip with a positive claim', () => {
    const { warnings } = validateExpenseItem({ category: 'km', amount: '31.50', km: { billable_km: '70' } }, undefined);
    expect(warnings).toHaveLength(0);
  });
});
