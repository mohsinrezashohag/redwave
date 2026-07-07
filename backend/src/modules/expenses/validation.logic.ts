/**
 * Expense Alert/Warning validation — PURE & deterministic (no I/O, no Prisma, no NestJS). — EXP-013
 *
 * Two severities, DERIVED (stateless) from the item + its category's field schema:
 *   • ALERT   — hard stop: missing required info. Blocks SAVE (the service throws 422 when any alert fires).
 *   • WARNING — soft policy: over a soft cap, or a km trip the commute deduction zeroed. Never blocks —
 *     the item saves already "flagged"; the approver just sees it.
 * Per-type CAPTURE fields are METADATA ONLY — this engine reads them for required/soft-cap checks but NEVER
 * sums them into money (#1). Numeric comparisons use decimal.js (no float).
 */
import { Decimal } from 'decimal.js';
import { CategorySchema } from './field-schema.logic';

export type Severity = 'alert' | 'warning';

export interface ValidationRule {
  code: string;
  severity: Severity;
  field?: string; // the field key / 'amount' / 'receipt_url' / 'km' the rule targets
  message: string;
}

export interface ValidationResult {
  alerts: ValidationRule[];
  warnings: ValidationRule[];
}

/** The minimal item shape the engine reads (works for both a create input and a stored row). */
export interface ValidatableItem {
  category: string;
  amount: string | null; // reimbursable amount in original_currency (non-km)
  receipt_url?: string | null;
  field_values?: Record<string, unknown> | null;
  km?: { billable_km: string } | null; // present only on a km item — for the commute-deduction warning
}

const isEmpty = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');
const fieldVal = (fv: Record<string, unknown> | null | undefined, key: string): unknown => (fv ? fv[key] : undefined);
const isNumeric = (s: string): boolean => /^\d+(\.\d+)?$/.test(s.trim());

/**
 * Compute the item's alerts + warnings against its category schema. A missing schema (unknown category)
 * yields only the core amount alert — the service separately rejects an inactive/unknown category.
 */
export function validateExpenseItem(item: ValidatableItem, schema: CategorySchema | undefined): ValidationResult {
  const alerts: ValidationRule[] = [];
  const warnings: ValidationRule[] = [];
  const isKm = item.category === 'km';
  const fields = schema?.fields ?? [];

  // ── ALERTS (block save) ─────────────────────────────────────────────────────────
  if (!isKm) {
    if (isEmpty(item.amount)) {
      alerts.push({ code: 'amount_required', severity: 'alert', field: 'amount', message: `Amount is required for a ${schema?.category_key ?? item.category} item` });
    }
    if (schema?.requires_receipt && isEmpty(item.receipt_url)) {
      alerts.push({ code: 'receipt_required', severity: 'alert', field: 'receipt_url', message: 'A receipt is required for this category' });
    }
    for (const def of fields) {
      if (def.required && isEmpty(fieldVal(item.field_values, def.key))) {
        alerts.push({ code: 'field_required', severity: 'alert', field: def.key, message: `${def.label} is required` });
      }
    }
  }

  // ── WARNINGS (flag, non-blocking) ───────────────────────────────────────────────
  if (!isKm && schema?.amount_soft_cap && !isEmpty(item.amount) && isNumeric(item.amount as string)) {
    if (new Decimal(item.amount as string).greaterThan(new Decimal(schema.amount_soft_cap))) {
      warnings.push({ code: 'amount_over_cap', severity: 'warning', field: 'amount', message: `Amount exceeds the ${schema.category_key} soft cap of ${schema.amount_soft_cap}` });
    }
  }
  for (const def of fields) {
    if (!def.soft_cap) continue;
    const raw = fieldVal(item.field_values, def.key);
    if (typeof raw === 'string' && isNumeric(raw) && new Decimal(raw).greaterThan(new Decimal(def.soft_cap))) {
      warnings.push({ code: 'field_over_cap', severity: 'warning', field: def.key, message: `${def.label} exceeds ${def.soft_cap}` });
    }
  }
  // km commute deduction zeroed the claim → $0 reimbursable (the named km Warning; fires only at $0, not on
  // every km item, so it isn't noisy). — EXP-013 / meeting-3 §5
  if (isKm && item.km && new Decimal(item.km.billable_km).isZero()) {
    warnings.push({ code: 'km_zero_claim', severity: 'warning', field: 'km', message: 'Trip below the commute threshold — $0 reimbursable after the deduction' });
  }

  return { alerts, warnings };
}
