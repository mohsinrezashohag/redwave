/**
 * Pure billing helpers — document-number and billing-week LABELS, plus pulling the structured `unpriced[]`
 * detail out of a generate 422 (carried on ApiError.details now that unwrap threads the response body
 * through). Returns null for any other error so the caller falls back to a normal error toast. No I/O.
 */
import { ApiError } from '../../lib/api/apiError';
import { displayDate } from '../../lib/format/date';
import type { BillingPeriod, UnpricedDetail } from './billing.types';

/** "Bill 27 · Jun 29 – Jul 5" — how Redwave labels a billing week. */
export const billLabel = (p: BillingPeriod): string =>
  `Bill ${p.period_number} · ${displayDate(p.start_date)} – ${displayDate(p.end_date)}`;

/** Display form of the gapless document numbers (1 → "STMT-00001" / "INV-00001"). */
export const statementNo = (n: number | null | undefined): string => `STMT-${String(n ?? 0).padStart(5, '0')}`;
export const invoiceNo = (n: number | null | undefined): string => `INV-${String(n ?? 0).padStart(5, '0')}`;

export function extractUnpriced(error: unknown): UnpricedDetail[] | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const details = error.details;
  if (!details || typeof details !== 'object' || !('unpriced' in details)) return null;
  const list = (details as { unpriced?: unknown }).unpriced;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list as UnpricedDetail[];
}
