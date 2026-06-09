/**
 * Pure holdback-release scheduling — the CONFIRMED sticky rule (SRS §17.1, now settled). The Super Admin
 * picks the rule ONCE; the Pay Run reads it at finalize and schedules each period's 30% hold into the
 * correct future cycle. Two modes (a later change affects only FUTURE holds — already-scheduled rows are
 * never re-resolved):
 *   • `cycles:N` — release in the **Nth pay period after** the origin (by period order).
 *   • `days:N`   — release in the **first later period whose payday is ≥ origin payday + N days**.
 * `next_cycle_after_30_days` is kept as an alias for `days:30`. — SRS §17.1 / BRD §6
 */
export interface ReleasePeriod {
  id: string;
  start_date: Date;
  payday: Date;
}

export type ReleaseMode = 'cycles' | 'days';

export interface ParsedReleaseRule {
  mode: ReleaseMode;
  n: number;
}

/** Parse a stored `release_rule` string into a structured rule (defaults to days:30 on anything unknown). */
export function parseReleaseRule(rule: string | null | undefined): ParsedReleaseRule {
  if (rule) {
    const m = /^(cycles|days):(\d+)$/.exec(rule.trim());
    if (m) {
      return { mode: m[1] as ReleaseMode, n: Number(m[2]) };
    }
  }
  return { mode: 'days', n: 30 }; // alias for the legacy `next_cycle_after_30_days`
}

/** Serialise a structured rule back to the canonical stored string. */
export function serialiseReleaseRule(mode: ReleaseMode, n: number): string {
  return `${mode}:${n}`;
}

export function resolveScheduledReleasePeriod<T extends ReleasePeriod>(
  origin: ReleasePeriod,
  periods: T[],
  releaseRule: string,
): T | null {
  const { mode, n } = parseReleaseRule(releaseRule);
  // Strictly-later periods, in order.
  const later = periods
    .filter((p) => p.start_date.getTime() > origin.start_date.getTime())
    .sort((a, b) => a.payday.getTime() - b.payday.getTime());

  if (mode === 'cycles') {
    // The Nth pay period after the origin (1-based; N=1 → the next period).
    return later[Math.max(1, n) - 1] ?? null;
  }

  // days: the first later period whose payday is ≥ origin payday + N days.
  const minPayday = new Date(origin.payday);
  minPayday.setUTCDate(minPayday.getUTCDate() + n);
  return later.find((p) => p.payday.getTime() >= minPayday.getTime()) ?? null;
}
