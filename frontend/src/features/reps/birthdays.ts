/**
 * Birthday display — pure. The server sends only the month/day and the coming date (never the birth year), so
 * there is nothing here that could reveal an age. — client meeting 2026-11-16
 */

/** "Today", "Tomorrow", "In 5 days". */
export function birthdayWhen(daysUntil: number): string {
  if (daysUntil <= 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

const FMT = new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The coming date as "Fri, Nov 20" (the 'YYYY-MM-DD' is a calendar day, so it is read at UTC midnight). */
export function birthdayDate(nextDate: string): string {
  const d = new Date(`${nextDate.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? nextDate : FMT.format(d);
}
