/**
 * exportFilename — THE naming convention for every file this app generates in the browser.
 *
 * `redwave-<source>[-<period>]-<generated>` (no extension — `exportRows` appends it):
 *   redwave-sales-2026-07-01_2026-07-23-20260723
 *   redwave-sales-20260723                          (no date filter)
 *   redwave-report-business-summary-20260723
 *
 * Why centrally, and why these three parts: the `redwave-` prefix clusters our files together in a
 * Downloads folder; the source says what it is; the filtered period says which slice of data it holds;
 * and the generation date means exporting twice never silently overwrites (or gets deduped by the
 * browser into "download (5).xlsx"). Callers pass parts, never a hand-built string — that is what keeps
 * the convention from drifting per call site.
 *
 * Pure and deterministic: the caller supplies `generatedOn`, so this never reads a clock.
 */
const PREFIX = 'redwave';

export interface ExportNameParts {
  /** What the file is — 'sales', 'clients', 'expenses-weekly', 'report-business-summary'. */
  source: string;
  /** The filtered range, when the export has one. A half-open range is fine (from only / to only). */
  period?: { from?: string; to?: string };
  /** 'YYYY-MM-DD' — the caller's `todayIso()`, so this stays pure and testable. */
  generatedOn: string;
}

/** Lower-case, keep [a-z0-9-], collapse the rest to single dashes; safe on every OS. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** '2026-07-23' → '20260723'. Anything that isn't a plain ISO date is slugged as-is. */
const compact = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, '') : slug(iso));

/**
 * The period segment: 'from_to', or just the end that was given. Empty when neither is set. Each date is
 * slugged individually so the `_` that separates them survives — it is what makes a range readable next
 * to the dash-joined name parts.
 */
function periodPart(period?: { from?: string; to?: string }): string {
  if (!period) return '';
  const from = period.from ? slug(period.from) : '';
  const to = period.to ? slug(period.to) : '';
  if (from && to) return `${from}_${to}`;
  return from || to;
}

export function exportFilename({ source, period, generatedOn }: ExportNameParts): string {
  return [PREFIX, slug(source), periodPart(period), compact(generatedOn)].filter(Boolean).join('-');
}
