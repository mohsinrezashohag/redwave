/**
 * Pure date helpers behind DatePicker — `'YYYY-MM-DD'` strings, UTC-anchored arithmetic (no timezone drift;
 * only "today" is zoned, and that comes from `todayInWinnipeg`, CLAUDE §2). No clock, no DOM: unit-tested.
 */
export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, '0');

export const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export const firstWeekday = (y: number, m: number): number => new Date(Date.UTC(y, m, 1)).getUTCDay();

/**
 * The date part of a value, or '' when it isn't a date. Accepts a bare `'YYYY-MM-DD'` and an API timestamp
 * (`'2026-11-16T00:00:00.000Z'`), so a value with a time part still highlights and anchors the calendar.
 */
export function toIsoDate(value: string | null | undefined): string {
  if (!value) return '';
  const head = value.slice(0, 10);
  return ISO_RE.test(head) ? head : '';
}

export function parseYm(iso: string): { y: number; m: number } {
  const [y, m] = iso.split('-').map(Number);
  return { y, m: m - 1 };
}

function fromUtc(d: Date): string {
  return ymd(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Move by whole months, keeping the day where it exists (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Weeks start on Sunday (matches the grid's header). */
export const startOfWeek = (iso: string): string => addDays(iso, -toUtc(iso).getUTCDay());
export const endOfWeek = (iso: string): string => addDays(iso, 6 - toUtc(iso).getUTCDay());

export function inRange(iso: string, min?: string, max?: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}

export function clampToRange(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** "Monday, November 16, 2026": the accessible name of a day cell. */
export function humanDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(toUtc(iso));
}

/** Years offered by the year dropdown: bounded by min/max, else ±100 years around today; always includes the viewed year. */
export function yearOptions(todayYear: number, viewYear: number, min?: string, max?: string): number[] {
  const from = Math.min(min ? Number(min.slice(0, 4)) : todayYear - 100, viewYear);
  const to = Math.max(max ? Number(max.slice(0, 4)) : todayYear + 100, viewYear);
  const out: number[] = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

/** True when the whole month lies outside [min, max] (its nav step / dropdown option is disabled). */
export function monthOutOfRange(y: number, m: number, min?: string, max?: string): boolean {
  const first = ymd(y, m, 1);
  const last = ymd(y, m, daysInMonth(y, m));
  return (!!max && first > max) || (!!min && last < min);
}

/**
 * Keyboard navigation inside the day grid (WAI-ARIA date-picker pattern). Returns the newly focused date,
 * or null when the key isn't a navigation key. Shift+PageUp/PageDown jumps a year.
 */
export function nextFocusDate(key: string, iso: string, shiftKey = false): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(iso, -1);
    case 'ArrowRight':
      return addDays(iso, 1);
    case 'ArrowUp':
      return addDays(iso, -7);
    case 'ArrowDown':
      return addDays(iso, 7);
    case 'Home':
      return startOfWeek(iso);
    case 'End':
      return endOfWeek(iso);
    case 'PageUp':
      return addMonths(iso, shiftKey ? -12 : -1);
    case 'PageDown':
      return addMonths(iso, shiftKey ? 12 : 1);
    default:
      return null;
  }
}
