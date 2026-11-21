/**
 * Birthday rules — PURE (no Nest, no Prisma, no clock: "today" is passed in as Winnipeg 'YYYY-MM-DD').
 * — client meeting 2026-11-16 ("Birthday scheduling")
 *
 * Only the MONTH and DAY of a date of birth are ever used here; the year (and so the age) never leaves these
 * functions. A Feb 29 birthday is celebrated on Feb 28 in a non-leap year.
 */

const DAY_MS = 86_400_000;

export const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** The month/day of a stored DOB ('YYYY-MM-DD…'), or null when it is not a date. */
export function monthDay(dob: string): { month: number; day: number } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

/** The birthday's date in `year` as 'YYYY-MM-DD' (Feb 29 → Feb 28 when `year` is not a leap year). */
export function birthdayInYear(month: number, day: number, year: number): string {
  const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** The next birthday on or after `today`, and how many days away it is (0 = today). Null for a bad DOB. */
export function nextBirthday(dob: string, today: string): { date: string; daysUntil: number } | null {
  const md = monthDay(dob);
  if (!md) return null;
  const year = Number(today.slice(0, 4));
  let date = birthdayInYear(md.month, md.day, year);
  if (date < today) date = birthdayInYear(md.month, md.day, year + 1);
  return { date, daysUntil: Math.round((utc(date) - utc(today)) / DAY_MS) };
}

/** Is `today` this DOB's birthday (with the Feb 29 → Feb 28 rule)? */
export function isBirthdayToday(dob: string, today: string): boolean {
  return nextBirthday(dob, today)?.daysUntil === 0;
}

/** The DOB as 'MM-DD' — the only part of it a birthday list may show. */
export function birthdayLabel(dob: string): string | null {
  const md = monthDay(dob);
  return md ? `${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}` : null;
}
