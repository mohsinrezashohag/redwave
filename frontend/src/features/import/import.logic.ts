/**
 * Pure import helpers (no I/O). Parse the JSON rows editor, summarise counts, and mirror the
 * reconcile-before-commit GATE *only to disable + explain* — the SERVER 422 is the real gate (incl. the
 * holdback reconcile_total check, which the UI never computes). The UI does NO matching/commit logic.
 */
import type { ImportBatch, MatchStatus } from './import.types';

const UNRESOLVED: MatchStatus[] = ['unmatched', 'duplicate', 'error'];

export interface RowCounts {
  matched: number;
  unmatched: number;
  duplicate: number;
  error: number;
  ignored: number;
  total: number;
}

/** Counts from the server's error_summary when present, else computed from the rows. */
export function countsOf(batch: ImportBatch): RowCounts {
  const s = batch.error_summary;
  if (s) {
    const matched = s.matched ?? 0, unmatched = s.unmatched ?? 0, duplicate = s.duplicate ?? 0, error = s.error ?? 0, ignored = s.ignored ?? 0;
    return { matched, unmatched, duplicate, error, ignored, total: matched + unmatched + duplicate + error + ignored };
  }
  const rows = batch.import_rows ?? [];
  const c: RowCounts = { matched: 0, unmatched: 0, duplicate: 0, error: 0, ignored: 0, total: rows.length };
  for (const r of rows) c[r.match_status] += 1;
  return c;
}

/** Rows still needing reconciliation (unmatched + duplicate + error). The Commit button disables while > 0. */
export function outstandingCount(batch: ImportBatch): number {
  const c = countsOf(batch);
  return c.unmatched + c.duplicate + c.error;
}

export function isUnresolved(status: MatchStatus): boolean {
  return UNRESOLVED.includes(status);
}
