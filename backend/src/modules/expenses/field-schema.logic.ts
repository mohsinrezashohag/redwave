/**
 * Per-type expense FIELD SCHEMA — PURE types + validation (no I/O, no Prisma, no NestJS). — EXP-002a
 *
 * A category's captured fields are config-driven (stored on expense_field_configs.fields, SA-editable),
 * NOT hardcoded. Each field def declares its key/label/type, whether it's required (missing → Alert), and
 * an optional numeric soft_cap (exceeded → Warning). `parseFieldDefs` safely reads the stored jsonb;
 * `assertFieldDefs` validates a def array at config create/update.
 */
export const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'select'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface ExpenseFieldDef {
  key: string; // snake_case, unique within the category
  label: string;
  type: FieldType;
  required: boolean; // missing/empty on save → Alert
  options?: string[]; // for type 'select'
  soft_cap?: string; // numeric/money threshold → Warning if the value exceeds it
}

/** The resolved schema for one category (config row → typed). */
export interface CategorySchema {
  category_key: string;
  requires_receipt: boolean;
  is_active: boolean;
  amount_soft_cap?: string | null; // category-level cap on the item amount → Warning
  fields: ExpenseFieldDef[];
}

const KEY = /^[a-z][a-z0-9_]*$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;
// Field keys must not collide with the core item fields (they live in a separate jsonb, but a clash confuses).
const RESERVED = new Set([
  'amount',
  'category',
  'receipt_url',
  'tags',
  'is_personal',
  'currency',
  'description',
  'expense_date',
  'client_id',
  'km',
]);

/** Best-effort coerce stored jsonb (unknown) into typed field defs — drops anything malformed. */
export function parseFieldDefs(raw: unknown): ExpenseFieldDef[] {
  if (!Array.isArray(raw)) return [];
  const defs: ExpenseFieldDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.key !== 'string' || typeof r.label !== 'string') continue;
    if (typeof r.type !== 'string' || !FIELD_TYPES.includes(r.type as FieldType)) continue;
    defs.push({
      key: r.key,
      label: r.label,
      type: r.type as FieldType,
      required: r.required === true,
      ...(Array.isArray(r.options) ? { options: r.options.filter((o): o is string => typeof o === 'string') } : {}),
      ...(typeof r.soft_cap === 'string' ? { soft_cap: r.soft_cap } : {}),
    });
  }
  return defs;
}

/**
 * Validate a field-def array for config create/update. Returns a list of human-readable errors (empty = ok).
 * Rules: snake_case unique keys (not reserved); a valid type; select → ≥1 option; soft_cap a decimal string
 * only on number/money fields.
 */
export function assertFieldDefs(defs: ExpenseFieldDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    const at = def.key || '(missing key)';
    if (!KEY.test(def.key)) errors.push(`field '${at}': key must be snake_case`);
    if (RESERVED.has(def.key)) errors.push(`field '${at}': key is reserved`);
    if (seen.has(def.key)) errors.push(`field '${at}': duplicate key`);
    seen.add(def.key);
    if (!def.label || !def.label.trim()) errors.push(`field '${at}': label is required`);
    if (!FIELD_TYPES.includes(def.type)) errors.push(`field '${at}': unknown type '${def.type}'`);
    if (def.type === 'select' && (!def.options || def.options.length === 0)) {
      errors.push(`field '${at}': a select field needs at least one option`);
    }
    if (def.soft_cap != null) {
      if (!DECIMAL.test(def.soft_cap)) errors.push(`field '${at}': soft_cap must be a decimal string`);
      if (def.type !== 'number' && def.type !== 'money') errors.push(`field '${at}': soft_cap only applies to a number/money field`);
    }
  }
  return errors;
}
