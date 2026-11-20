/**
 * historyDiff — turns an audit row's before/after JSON into readable "Field: before → after" changes for the
 * per-record History panel. Pure. Internal ids (uuids) are left out of the readable view: they mean nothing on
 * screen, and the raw JSON stays one click away for an audit. 2026-11-18
 */

export interface HistoryChange {
  field: string;
  before: string | null;
  after: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const MIDNIGHT = /T00:00:00(\.0+)?(Z|[+-]00:?00)?$/;

/** Field labels that read badly when generated from the key. */
const LABELS: Record<string, string> = {
  is_greenfield: 'Greenfield',
  is_personal: 'Personal',
  mpu_id: 'MPU ID',
  sale_code: 'Sale ID',
  province_state: 'Province/State',
  item_count: 'Products',
  amount_cad: 'Amount (CAD)',
  fx_rate: 'FX rate',
  sin: 'SIN',
  dob: 'Date of birth',
};

/** Action verbs as a person would say them. */
const ACTIONS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  edit: 'Edited',
  delete: 'Deleted',
  validate: 'Validated',
  approve: 'Approved',
  reject: 'Rejected',
  finalize: 'Marked paid',
  export: 'Exported',
  download: 'Downloaded',
  restore: 'Restored',
  sign: 'Signed',
  decline: 'Declined',
  approve_duplicate: 'Duplicate approved',
  greenfield: 'Greenfield changed',
};

/** "sent_back" → "Sent back"; two-letter words are codes ("tv" → "TV"). */
const words = (v: string): string =>
  v
    .split('_')
    .map((w, i) => (w.length <= 2 ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? (action ? words(action.replace(/-/g, '_')) : action);
}

export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const text = key.replace(/^is_/, '').replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An internal identifier, hidden from the readable view (a business code like mpu_id is not a uuid). */
function isInternalId(key: string, value: unknown): boolean {
  if (typeof value === 'string' && UUID.test(value)) return true;
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && UUID.test(v))) return true;
  // An empty reference ("duplicate_of_sale_id": null) is noise.
  return (key === 'id' || key.endsWith('_id') || key.endsWith('_ids')) && (value === null || value === undefined);
}

export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) {
      // A date-only value (stored at UTC midnight) shows as the date; a real timestamp keeps its time.
      return value.length === 10 || MIDNIGHT.test(value) ? value.slice(0, 10) : value.replace('T', ' ').slice(0, 16);
    }
    // Enum-like values ("entered", "sent_back") read as words.
    if (/^[a-z]+(_[a-z]+)*$/.test(value)) return words(value);
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => (v !== null && typeof v === 'object' ? null : formatValue(v))).filter(Boolean);
    return parts.length === value.length ? parts.join(', ') : `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  return 'Updated';
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * The readable changes between two snapshots. A field present on only one side still shows (a create has
 * only "after"); a field whose readable value did not change is skipped.
 */
export function describeChanges(before: unknown, after: unknown): HistoryChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out: HistoryChange[] = [];
  for (const key of keys) {
    if (isInternalId(key, key in a ? a[key] : b[key])) continue;
    const from = key in b ? formatValue(b[key]) : null;
    const to = key in a ? formatValue(a[key]) : null;
    if (from === to) continue;
    out.push({ field: fieldLabel(key), before: from, after: to });
  }
  return out;
}
