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

/**
 * The cap is PER UNIT when a field declares itself the multiplier. This is what lets ONE item cover a day's
 * lunch AND dinner without being flagged for doing in one item what two items do unflagged. — EXP-013
 */
describe('validateExpenseItem — a per-unit soft cap (one item, several meals)', () => {
  const withCount = (over: Partial<CategorySchema> = {}): CategorySchema =>
    mealsSchema({
      fields: [
        { key: 'vendor', label: 'Vendor', type: 'text', required: true },
        { key: 'meals_count', label: 'Meals covered', type: 'number', required: false, multiplies_cap: true },
      ],
      ...over,
    });

  it('one item covering 2 meals at $45 does NOT warn — the $30 cap is per meal', () => {
    const { warnings } = validateExpenseItem(
      item({ amount: '45.00', field_values: { vendor: 'Earls', meals_count: '2' } }),
      withCount(),
    );
    expect(warnings).toHaveLength(0);
  });

  it('splitting the SAME spend across two items behaves identically (neither shape is penalised)', () => {
    const half = validateExpenseItem(item({ amount: '22.50', field_values: { vendor: 'Earls' } }), withCount());
    const combined = validateExpenseItem(
      item({ amount: '45.00', field_values: { vendor: 'Earls', meals_count: '2' } }),
      withCount(),
    );
    expect(half.warnings).toHaveLength(0);
    expect(combined.warnings).toHaveLength(0);
  });

  it('still warns once the scaled cap is genuinely exceeded, and names it', () => {
    const { warnings } = validateExpenseItem(
      item({ amount: '61.00', field_values: { vendor: 'Earls', meals_count: '2' } }),
      withCount(),
    );
    expect(warnings.map((w) => w.code)).toEqual(['amount_over_cap']);
    expect(warnings[0].message).toContain('60.00');
    expect(warnings[0].message).toContain('30.00 × 2');
  });

  it('a blank / non-numeric / zero count can never LOWER the bar — it falls back to one unit', () => {
    for (const meals_count of ['', 'two', '0', '-3']) {
      const { warnings } = validateExpenseItem(
        item({ amount: '45.00', field_values: { vendor: 'Earls', meals_count } }),
        withCount(),
      );
      expect(warnings.map((w) => w.code)).toEqual(['amount_over_cap']);
    }
  });

  it('a category with NO multiplier field is unchanged (the count field is opt-in)', () => {
    const { warnings } = validateExpenseItem(
      item({ amount: '45.00', field_values: { vendor: 'Earls', meals_count: '2' } }),
      mealsSchema(), // no field flagged multiplies_cap
    );
    expect(warnings.map((w) => w.code)).toEqual(['amount_over_cap']);
  });
});
