/**
 * The ONE format for an import row's issue — PURE. Every message reads:
 *
 *     <Column>: <what is wrong, quoting the value>. <How to fix it>.
 *
 * e.g. `Rep: "Abdul Malak" was not found among active reps. Add the rep, or use their rep code or partner
 * code.` Operators read these on the reconcile screen and in the error-report CSV, so they name the column a
 * person sees (never a key like `client_code`), quote what the file actually said, and end with the fix.
 * — 2026-11-28 (operators could not tell what "client_code is required" meant)
 */

/** Plain column names for the system fields (what the operator sees, not the key). */
const LABELS: Record<string, string> = {
  client_code: 'Client',
  rep_code: 'Rep',
  product_types: 'Product types',
  product_type: 'Product type',
  product_name: 'Product',
  sale_date: 'Sale date',
  activation_date: 'Activation date',
  customer_name: 'Customer',
  customer_first_name: 'First name',
  customer_last_name: 'Last name',
  billed_amount: 'Billed amount',
  billing_amount: 'Billing amount',
  amount: 'Amount',
  effective_from: 'Effective from',
  effective_to: 'Effective to',
  rate_kind: 'Rate kind',
  rate_per_km: 'Rate per km',
  stream: 'Stream',
  name: 'Name',
  full_name: 'Full name',
  hire_date: 'Hire date',
  market: 'Market',
  mpu_id: 'MPU ID',
  status: 'Status',
  is_greenfield: 'Greenfield',
};

/** The column name an operator sees for a system field. */
export function fieldLabel(field: string): string {
  if (LABELS[field]) return LABELS[field];
  const text = field.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const sentence = (s: string): string => {
  const t = s.trim();
  return t === '' ? '' : /[.?!]$/.test(t) ? t : `${t}.`;
};

/** `<Label>: <problem>. <fix>.` — the standard row issue. */
export function rowIssue(field: string, problem: string, fix?: string): string {
  return [`${fieldLabel(field)}: ${sentence(problem)}`, fix ? sentence(fix) : ''].filter(Boolean).join(' ');
}

/** A value quoted for a message: `"VF"`, or `(blank)`. */
export function quote(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text === '' ? '(blank)' : `"${text}"`;
}

/** A required column with nothing in it. */
export function missingIssue(field: string, example?: string): string {
  return rowIssue(field, 'missing', `Fill in the ${fieldLabel(field).toLowerCase()}${example ? ` (for example ${example})` : ''}`);
}

/** How each value type should be written, for "is not a valid …" messages. */
const FORMAT_HINT: Record<string, { what: string; fix: string }> = {
  date: { what: 'a valid date', fix: 'Use YYYY-MM-DD, for example 2026-11-24' },
  money: { what: 'a valid amount', fix: 'Use a number, for example 89.99' },
  int: { what: 'a whole number', fix: 'Use digits only, for example 3' },
  bool: { what: 'a yes/no value', fix: 'Use TRUE or FALSE (Yes / No also work)' },
};

/** A non-blank value that could not be read as its type. */
export function invalidIssue(field: string, type: string, value: unknown): string {
  const hint = FORMAT_HINT[type] ?? { what: 'valid', fix: 'Check the value' };
  return rowIssue(field, `${quote(value)} is not ${hint.what}`, hint.fix);
}

/** A client code the system does not have. */
export function clientNotFoundIssue(code: unknown): string {
  return rowIssue('client_code', `${quote(code)} was not found`, 'Add the client under Clients, or fix the code');
}

/** A rep the system does not have (or who is not active). */
export function repNotFoundIssue(code: unknown): string {
  return rowIssue('rep_code', `${quote(code)} was not found among active reps`, 'Add the rep, or use their rep code or partner code');
}
