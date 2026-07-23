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
import { CategorySchema, ExpenseFieldDef } from './field-schema.logic';

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
 * How many CAP UNITS this item covers — the value of the field flagged `multiplies_cap`, else 1. A blank,
 * non-numeric or <1 value falls back to 1, so a malformed entry can never LOWER the bar for a warning.
 */
function capUnits(item: ValidatableItem, fields: ExpenseFieldDef[]): number {
  const def = fields.find((f) => f.multiplies_cap);
  if (!def) return 1;
  const raw = fieldVal(item.field_values, def.key);
  if (typeof raw !== 'string' || !isNumeric(raw)) return 1;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

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
    // The cap is PER UNIT when a field declares itself the multiplier: one item covering a day's lunch AND
    // dinner is judged against 2 × the cap, so combining meals into one item is no longer penalised
    // relative to splitting them. Units default to 1, so a category without a multiplier is unchanged.
    const units = capUnits(item, fields);
    const cap = new Decimal(schema.amount_soft_cap).times(units);
    if (new Decimal(item.amount as string).greaterThan(cap)) {
      const per = units > 1 ? ` (${schema.amount_soft_cap} × ${units})` : '';
      warnings.push({
        code: 'amount_over_cap',
        severity: 'warning',
        field: 'amount',
        message: `Amount exceeds the ${schema.category_key} soft cap of ${cap.toFixed(2)}${per}`,
      });
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
