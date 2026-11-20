/**
 * Run window — what a commission report (pay run) covers. PURE: no Prisma, no clock.
 *
 * Client decision 2026-11-16: pay runs are no longer fixed bi-weekly periods. The admin picks a SALE-DATE
 * range (inclusive), optionally one client and/or one rep, generates a report, and marks it paid. Legacy
 * runs still carry a pay period, and their window is that period's [start, end]. Either way `sale_date`
 * governs which sales a run covers (#7) — never validation or activation date.
 *
 * Dates are 'YYYY-MM-DD' parsed at UTC midnight on both sides (CLAUDE §2 dates convention), so the
 * comparisons here are timezone-agnostic.
 */
import { DomainError } from '../../common/errors/domain-error';

export type RunKind = 'period' | 'range';

export interface RunWindow {
  kind: RunKind;
  /** Inclusive first sale_date (UTC midnight). */
  from: Date;
  /** Inclusive last sale_date (UTC midnight). */
  to: Date;
  /** A range run may be limited to one client; legacy period runs never are. */
  clientId: string | null;
  /** A range run may be limited to one rep; legacy period runs never are. */
  repId: string | null;
  /** Set only for a legacy period run. */
  payPeriodId: string | null;
  periodNumber: number | null;
}

/** The columns of a pay_runs row (with its optional period) that define its window. */
export interface RunWindowSource {
  pay_period_id: string | null;
  pay_period?: { id: string; period_number: number; start_date: Date; end_date: Date } | null;
  date_from: Date | null;
  date_to: Date | null;
  client_id: string | null;
  rep_id: string | null;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** 'YYYY-MM-DD' → UTC-midnight Date, or null when the text is not a real calendar date. */
export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || isoDate(d) !== value ? null : d;
}

/** Validate a requested range: both real dates, from ≤ to. A client fault → DomainError (422). */
export function parseRange(dateFrom: string, dateTo: string): { from: Date; to: Date } {
  const from = parseIsoDate(dateFrom);
  const to = parseIsoDate(dateTo);
  if (!from || !to) {
    throw new DomainError('PAY_RUN_RANGE_INVALID', 'Dates must be real calendar dates in YYYY-MM-DD form.');
  }
  if (from.getTime() > to.getTime()) {
    throw new DomainError('PAY_RUN_RANGE_INVALID', 'The start date must be on or before the end date.');
  }
  return { from, to };
}

/** The window a stored run covers. A row with neither a period nor a range is a server fault (bare Error). */
export function windowOfRun(run: RunWindowSource): RunWindow {
  if (run.pay_period_id && run.pay_period) {
    return {
      kind: 'period',
      from: run.pay_period.start_date,
      to: run.pay_period.end_date,
      clientId: null,
      repId: null,
      payPeriodId: run.pay_period.id,
      periodNumber: run.pay_period.period_number,
    };
  }
  if (run.date_from && run.date_to) {
    return {
      kind: 'range',
      from: run.date_from,
      to: run.date_to,
      clientId: run.client_id,
      repId: run.rep_id,
      payPeriodId: null,
      periodNumber: null,
    };
  }
  throw new Error('pay run has neither a pay period nor a date range');
}

/** The human label of a run: its own label, else "Pay period #N", else the date range. */
export function runDisplayLabel(window: RunWindow, label: string | null): string {
  if (label && label.trim().length > 0) return label.trim();
  if (window.kind === 'period') return `Pay period #${window.periodNumber}`;
  return `${isoDate(window.from)} to ${isoDate(window.to)}`;
}

export interface DateSpan {
  from: Date;
  to: Date;
}

/**
 * The parts of `span` NOT covered by any of `covered` (all inclusive, whole days), in date order.
 *
 * Used for expenses: an approved expense item carries no "paid in run" marker, so a range run reimburses
 * only the days that no earlier finalized run for the same rep already covered. This is what stops two
 * overlapping reports from reimbursing the same expense twice.
 */
export function uncoveredSpans(span: DateSpan, covered: DateSpan[]): DateSpan[] {
  const sorted = covered
    .filter((c) => c.to.getTime() >= span.from.getTime() && c.from.getTime() <= span.to.getTime())
    .sort((a, b) => a.from.getTime() - b.from.getTime());
  const out: DateSpan[] = [];
  let cursor = span.from.getTime();
  const end = span.to.getTime();
  for (const c of sorted) {
    if (cursor > end) break;
    const cFrom = c.from.getTime();
    const cTo = c.to.getTime();
    if (cFrom > cursor) {
      out.push({ from: new Date(cursor), to: new Date(Math.min(cFrom - DAY_MS, end)) });
    }
    cursor = Math.max(cursor, cTo + DAY_MS);
  }
  if (cursor <= end) out.push({ from: new Date(cursor), to: new Date(end) });
  return out;
}
