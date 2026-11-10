/**
 * Period generation — PURE & deterministic (no I/O, no Prisma, no clock).
 *
 * Generalises what `pay-periods.seed-data.ts` and `billing-periods.seed-data.ts` each hard-coded, so the
 * calendars become admin CONFIG: anchor date, length in days, and (pay only) the payday offset. The seed
 * generators still exist and still produce the genesis 2026 calendars — this is what regenerates FUTURE
 * periods when an admin changes the config.
 *
 * TWO CALENDARS, never substituted (§14 rule 1). Pay periods govern rep pay and a sale's period is derived
 * from its `sale_date` (#7); billing periods govern client billing and are numbered sequentially. A bill
 * straddles two pay periods, and that offset is deliberate — Redwave asked to control it.
 *
 * FORWARD-ONLY is enforced by the caller, not here: this module says what the calendar SHOULD look like,
 * and the service decides which of those periods it is allowed to write. Keeping the decision out of the
 * pure layer is what lets the guard be tested independently of date arithmetic.
 *
 * Dates are 'YYYY-MM-DD' throughout and arithmetic is done at UTC midnight, so the logic is
 * timezone-agnostic — only "today" derivations are Winnipeg-zoned (`common/timezone.ts`).
 */

export interface PeriodShape {
  /** Anchor: the first period's start date, 'YYYY-MM-DD'. */
  anchorDate: string;
  /** Period length in days — 14 for the biweekly pay cycle, 7 for the weekly billing week. */
  lengthDays: number;
  /** Days after a period's END that reps are paid. Pay only; a bill has no payday. */
  paydayOffsetDays?: number | null;
}

export interface GeneratedPeriod {
  period_number: number;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string; // 'YYYY-MM-DD'
  /** Present only when the shape carries a payday offset (pay periods). */
  payday?: string;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days between two 'YYYY-MM-DD' dates (b − a). Exact: both sides are UTC midnight. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Validate a shape before anything is generated from it. A zero or negative length would produce periods
 * that overlap or invert, and a negative payday offset would pay a rep before the period closed — both
 * are configuration mistakes that must fail loudly rather than silently generating a broken calendar.
 */
export function validatePeriodShape(shape: PeriodShape): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shape.anchorDate)) {
    errors.push('anchor_date must be a YYYY-MM-DD date');
  } else if (Number.isNaN(new Date(`${shape.anchorDate}T00:00:00.000Z`).getTime())) {
    errors.push(`anchor_date '${shape.anchorDate}' is not a real date`);
  }
  if (!Number.isInteger(shape.lengthDays) || shape.lengthDays < 1) {
    errors.push('length_days must be a whole number of at least 1');
  } else if (shape.lengthDays > 366) {
    errors.push('length_days must be 366 or fewer — a period longer than a year is not a cycle');
  }
  if (shape.paydayOffsetDays !== undefined && shape.paydayOffsetDays !== null) {
    if (!Number.isInteger(shape.paydayOffsetDays) || shape.paydayOffsetDays < 0) {
      errors.push('payday_offset_days must be a whole number of 0 or more — a rep is never paid before the period closes');
    }
  }
  return errors;
}

/**
 * The period NUMBER that a date falls in, for a given shape. Numbering is 1-based from the anchor and is
 * derived rather than stored, so a regenerated calendar keeps numbering continuous with what came before.
 * Returns null for a date before the anchor — that period does not exist in this calendar.
 */
export function periodNumberFor(shape: PeriodShape, date: string): number | null {
  const offset = daysBetween(shape.anchorDate, date);
  if (offset < 0) return null;
  return Math.floor(offset / shape.lengthDays) + 1;
}

/** One period by its 1-based number. */
export function periodByNumber(shape: PeriodShape, periodNumber: number): GeneratedPeriod {
  const start = addDays(shape.anchorDate, (periodNumber - 1) * shape.lengthDays);
  const end = addDays(start, shape.lengthDays - 1);
  const period: GeneratedPeriod = { period_number: periodNumber, start_date: start, end_date: end };
  if (shape.paydayOffsetDays !== undefined && shape.paydayOffsetDays !== null) {
    period.payday = addDays(end, shape.paydayOffsetDays);
  }
  return period;
}

/**
 * Generate `count` periods starting at `fromNumber`. The caller picks `fromNumber` — normally the first
 * period that is safe to touch — so this module never has to know which periods are frozen.
 */
export function generatePeriods(shape: PeriodShape, fromNumber: number, count: number): GeneratedPeriod[] {
  const periods: GeneratedPeriod[] = [];
  for (let i = 0; i < count; i += 1) {
    periods.push(periodByNumber(shape, fromNumber + i));
  }
  return periods;
}

/**
 * Which BILLING periods fall inside one PAY period — the overlap the packet asks to surface.
 *
 * This is the two-calendar boundary made visible instead of discovered later: because the calendars have
 * different anchors and lengths, a billing week routinely straddles two pay periods. A week is reported as
 * overlapping when it shares ANY day with the pay period, and `fully_inside` distinguishes the weeks that
 * sit entirely within it from the ones spanning the boundary.
 */
export interface CalendarOverlap {
  billing_period_number: number;
  start_date: string;
  end_date: string;
  fully_inside: boolean;
}

export function overlappingBillingPeriods(
  payShape: PeriodShape,
  billingShape: PeriodShape,
  payPeriodNumber: number,
): CalendarOverlap[] {
  const pay = periodByNumber(payShape, payPeriodNumber);
  const first = periodNumberFor(billingShape, pay.start_date);
  const last = periodNumberFor(billingShape, pay.end_date);
  // A pay period entirely before the billing anchor overlaps nothing — a real state during a transition,
  // not an error.
  if (last === null) return [];

  const overlaps: CalendarOverlap[] = [];
  for (let n = Math.max(1, first ?? 1); n <= last; n += 1) {
    const week = periodByNumber(billingShape, n);
    if (week.end_date < pay.start_date || week.start_date > pay.end_date) continue;
    overlaps.push({
      billing_period_number: n,
      start_date: week.start_date,
      end_date: week.end_date,
      fully_inside: week.start_date >= pay.start_date && week.end_date <= pay.end_date,
    });
  }
  return overlaps;
}
