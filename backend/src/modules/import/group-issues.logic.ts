/**
 * Issue grouping — PURE & deterministic (no I/O). Collapses per-row issues into one entry per DISTINCT
 * problem. A 16-row file where every row hits the same unknown product type is ONE thing to fix, not 16;
 * listing it 16 times buries the signal and makes a small file look catastrophic.
 *
 * Row numbers are kept (capped, with the true count) so the operator can jump straight to an example.
 * — SRS §15 IMP-005
 */

export interface RowIssue {
  row_number: number;
  match_status: string;
  issue: string | null;
}

export interface IssueGroup {
  /** The issue text, with row-specific values folded out so identical problems group together. */
  issue: string;
  match_status: string;
  count: number;
  /** Up to `MAX_EXAMPLE_ROWS` row numbers, ascending. */
  row_numbers: number[];
  /** One verbatim example, when the grouped issues differed only in their quoted value. */
  sample_issue: string;
}

/** Enough rows to find the problem in the file; more is noise. */
const MAX_EXAMPLE_ROWS = 10;

/**
 * Fold row-specific detail out of an issue so near-identical problems group. Quoted values and bare codes
 * vary per row (`client VF not found` / `client RF not found`), but the FIX is the same.
 */
function groupingKey(issue: string): string {
  return issue
    .replace(/"[^"]*"/g, '"…"') // quoted values: unknown product type "Internet, TV"
    .replace(/\b[A-Z]{2,}-[A-Z0-9-]+\b/g, '…') // rep/sale codes: RW-D-0001
    .replace(/\bMPU\s*\S+/gi, 'MPU …')
    .trim();
}

/**
 * Group the rows that need attention. `matched` and `ignored` rows are not problems and are excluded.
 * Groups come back largest-first so the biggest blocker leads.
 */
export function groupIssues(rows: RowIssue[]): IssueGroup[] {
  const needsAttention = rows.filter((r) => ['unmatched', 'duplicate', 'error'].includes(r.match_status));
  const byKey = new Map<string, { group: IssueGroup; key: string }>();

  for (const row of needsAttention) {
    const issue = row.issue ?? `row is ${row.match_status}`;
    const key = `${row.match_status}|${groupingKey(issue)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.group.count += 1;
      if (existing.group.row_numbers.length < MAX_EXAMPLE_ROWS) {
        existing.group.row_numbers.push(row.row_number);
      }
    } else {
      byKey.set(key, {
        key,
        group: {
          issue: groupingKey(issue),
          match_status: row.match_status,
          count: 1,
          row_numbers: [row.row_number],
          sample_issue: issue,
        },
      });
    }
  }

  return [...byKey.values()]
    .map((v) => v.group)
    .sort((a, b) => b.count - a.count || a.row_numbers[0] - b.row_numbers[0]);
}

/** A one-line human summary of the blocking problems, for a toast or a log line. */
export function summariseIssues(groups: IssueGroup[]): string | null {
  if (groups.length === 0) return null;
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const lead = groups[0];
  const rest = groups.length - 1;
  const tail = rest > 0 ? ` (+${rest} other issue${rest === 1 ? '' : 's'})` : '';
  return `${total} row${total === 1 ? '' : 's'} need attention — ${lead.count}× ${lead.sample_issue}${tail}`;
}
