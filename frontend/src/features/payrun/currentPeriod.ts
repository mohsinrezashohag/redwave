/**
 * currentPeriod — which pay period "today" falls in, and its short label for the top-bar cycle chip.
 * Pure (today is passed in). Dates compare as `YYYY-MM-DD` strings, the same way the backend resolves a
 * sale's period from its sale_date (#7): the period whose [start, end] contains the day.
 */

interface PeriodLike {
  period_number: number;
  start_date: string;
  end_date: string;
}

/** The period containing `today` ('YYYY-MM-DD'), or null when the schedule doesn't cover it. */
export function findCurrentPeriod<T extends PeriodLike>(periods: readonly T[], today: string): T | null {
  return periods.find((p) => p.start_date.slice(0, 10) <= today && today <= p.end_date.slice(0, 10)) ?? null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD…' → 'Nov 8' (string parts only — no Date, so no timezone shift). */
function shortDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** 'Cycle 23 · Nov 8 – Nov 21' */
export function cycleLabel(p: PeriodLike): string {
  return `Cycle ${p.period_number} · ${shortDay(p.start_date)} – ${shortDay(p.end_date)}`;
}
