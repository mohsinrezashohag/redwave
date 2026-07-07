/**
 * FE mirror of the backend expense Alert/Warning engine (EXP-013) — for LIVE inline feedback while editing.
 * Alerts block submit; Warnings show but allow "save anyway". The backend re-validates authoritatively — this
 * is convenience only. Money soft-cap comparisons use exact integer cents (no float on money, #1).
 */
import type { FieldConfig } from './expenses.types';

export type Severity = 'alert' | 'warning';
export interface FeRule {
  code: string;
  severity: Severity;
  field?: string;
  message: string;
}

export interface ValidatableFormItem {
  category: string;
  amount?: string;
  receipt_url?: string;
  field_values?: Record<string, string>;
  /** Billable km (computed from the form) — 0 triggers the commute-deduction warning. */
  billable_km?: number | null;
}

const isEmpty = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');
const isNumeric = (s: string): boolean => /^\d+(\.\d+)?$/.test(s.trim());
/** Exact integer cents from a "X.YY" money string (no float on money, #1). */
const cents = (s: string): number => {
  const [i, d = ''] = s.trim().split('.');
  return Number(i || '0') * 100 + Number((d + '00').slice(0, 2));
};

/** Compute the derived alerts + warnings for one form item against its category config. */
export function validateFormItem(item: ValidatableFormItem, config: FieldConfig | undefined): { alerts: FeRule[]; warnings: FeRule[] } {
  const alerts: FeRule[] = [];
  const warnings: FeRule[] = [];
  const isKm = item.category === 'km';
  const fields = config?.fields ?? [];

  if (!isKm) {
    if (isEmpty(item.amount)) alerts.push({ code: 'amount_required', severity: 'alert', field: 'amount', message: 'Amount is required' });
    if (config?.requires_receipt && isEmpty(item.receipt_url)) alerts.push({ code: 'receipt_required', severity: 'alert', field: 'receipt_url', message: 'A receipt is required for this category' });
    for (const def of fields) {
      if (def.required && isEmpty(item.field_values?.[def.key])) alerts.push({ code: 'field_required', severity: 'alert', field: def.key, message: `${def.label} is required` });
    }
    if (config?.amount_soft_cap && item.amount && isNumeric(item.amount) && cents(item.amount) > cents(config.amount_soft_cap)) {
      warnings.push({ code: 'amount_over_cap', severity: 'warning', field: 'amount', message: `Amount exceeds the soft cap of ${config.amount_soft_cap}` });
    }
    for (const def of fields) {
      const raw = item.field_values?.[def.key];
      if (def.soft_cap && raw && isNumeric(raw) && cents(raw) > cents(def.soft_cap)) {
        warnings.push({ code: 'field_over_cap', severity: 'warning', field: def.key, message: `${def.label} exceeds ${def.soft_cap}` });
      }
    }
  }
  if (isKm && item.billable_km === 0) {
    warnings.push({ code: 'km_zero_claim', severity: 'warning', field: 'km', message: 'Trip below the commute threshold — $0 reimbursable after the deduction' });
  }
  return { alerts, warnings };
}
