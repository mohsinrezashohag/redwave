/** Date helpers — the app handles dates as `YYYY-MM-DD` strings (no Date math; sale_date governs #7). */

/** Today as `YYYY-MM-DD` (local date). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Today as `YYYY-MM-DD` in America/Winnipeg — the canonical business timezone (CLAUDE §2). Use this, not
 * `todayIso()`, wherever "today" decides WHICH PERIOD we are in, so a viewer in another timezone sees the
 * same current period the backend computes. `now` is injectable for tests.
 */
export function todayInWinnipeg(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Winnipeg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * An API timestamp as "11 Nov 2026, 10:35", in America/Winnipeg (the business timezone, CLAUDE §2) — for
 * "when did this happen" lines such as the last sales export. '' for a missing value.
 */
export function displayDateTime(value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Winnipeg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/** Display an API date/datetime string as `YYYY-MM-DD` (the API serializes @db.Date as an ISO string). */
export function displayDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—';
}

/**
 * Coarse relative time ("just now", "5m ago", "3h ago", "2d ago", else the date) for activity feeds like
 * notifications. Display-only; falls back to the date for anything older than ~a week.
 */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return displayDate(value);
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return displayDate(value);
}
