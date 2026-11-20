/**
 * Sale edit window + change diff — PURE (no I/O, no clock: the caller passes `today`).
 *
 * Client meeting 2026-11-16: "Admins can edit within 5 days. If a rep edits, the system sends a notification
 * to the admin that the rep requested an edit. The same 5-day window applies to both."
 *  - The window is counted on the WINNIPEG calendar day the sale was ENTERED (`created_at`, CLAUDE §2 dates):
 *    entered on day D, it may be edited through D + 5 inclusive.
 *  - Only a sale that is not frozen may be edited: `entered` or `validated`. Once it is in a pay run, paid,
 *    clawed back, historical or deleted, it never is (#2 snapshots; the pay run reads it).
 */
import { todayInWinnipeg } from '../../common/timezone';

export const EDIT_WINDOW_DAYS = 5;

const EDITABLE_STATUSES = new Set(['entered', 'validated']);

const addDays = (ymd: string, days: number): string => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The last Winnipeg day ('YYYY-MM-DD') a sale entered at `createdAt` may still be edited. */
export function editWindowEndsOn(createdAt: Date): string {
  return addDays(todayInWinnipeg(createdAt), EDIT_WINDOW_DAYS);
}

/** True when the sale's status is editable AND `today` (Winnipeg 'YYYY-MM-DD') is inside the window. */
export function isSaleEditable(status: string, createdAt: Date, today: string): boolean {
  return EDITABLE_STATUSES.has(status) && today <= editWindowEndsOn(createdAt);
}

/** The editable fields of a sale (mpu_id, client, rep and sale_date are identity fields and never change). */
export const EDITABLE_TEXT_FIELDS = [
  'customer_name',
  'customer_first_name',
  'customer_last_name',
  'street',
  'city',
  'province_state',
  'postal_code',
  'activation_date',
] as const;

export type EditableTextField = (typeof EDITABLE_TEXT_FIELDS)[number];

/** A requested edit, normalised: only the fields that actually change. `items` are product ids. */
export interface SaleChanges {
  customer_name?: string;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  street?: string;
  city?: string;
  province_state?: string;
  postal_code?: string;
  activation_date?: string | null;
  is_greenfield?: boolean;
  items?: string[];
}

export interface SaleSnapshotForDiff {
  customer_name: string;
  customer_first_name: string | null;
  customer_last_name: string | null;
  street: string;
  city: string;
  province_state: string;
  postal_code: string;
  activation_date: Date | null;
  is_greenfield: boolean;
  product_ids: string[];
}

export interface SaleEditInput {
  customer_name?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  street?: string;
  city?: string;
  province_state?: string;
  postal_code?: string;
  activation_date?: string;
  is_greenfield?: boolean;
  items?: { product_id: string }[];
}

const blankToNull = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};
const sameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
};

/**
 * Keep only what differs from the current sale. An edit request stores exactly this (so the approver's diff
 * shows real changes), and an empty result means there is nothing to request.
 */
export function diffSaleChanges(current: SaleSnapshotForDiff, input: SaleEditInput): SaleChanges {
  const out: SaleChanges = {};
  const text = (key: 'customer_name' | 'street' | 'city' | 'province_state' | 'postal_code') => {
    const next = input[key]?.trim();
    if (next !== undefined && next !== '' && next !== current[key]) out[key] = next;
  };
  text('customer_name');
  text('street');
  text('city');
  text('province_state');
  text('postal_code');
  for (const key of ['customer_first_name', 'customer_last_name'] as const) {
    if (input[key] === undefined) continue;
    const next = blankToNull(input[key]);
    if (next !== current[key]) out[key] = next;
  }
  if (input.activation_date !== undefined) {
    const next = blankToNull(input.activation_date);
    const cur = current.activation_date ? current.activation_date.toISOString().slice(0, 10) : null;
    if (next !== cur) out.activation_date = next;
  }
  if (input.is_greenfield !== undefined && input.is_greenfield !== current.is_greenfield) {
    out.is_greenfield = input.is_greenfield;
  }
  if (input.items !== undefined) {
    const ids = [...new Set(input.items.map((i) => i.product_id))];
    if (!sameSet(ids, current.product_ids)) out.items = ids;
  }
  return out;
}
