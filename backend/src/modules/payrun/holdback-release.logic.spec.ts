import { parseReleaseRule, resolveScheduledReleasePeriod, serialiseReleaseRule } from './holdback-release.logic';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const periods = [
  { id: 'P1', start_date: d('2026-01-04'), payday: d('2026-01-30') },
  { id: 'P2', start_date: d('2026-01-18'), payday: d('2026-02-13') },
  { id: 'P3', start_date: d('2026-02-01'), payday: d('2026-02-27') },
  { id: 'P4', start_date: d('2026-02-15'), payday: d('2026-03-13') },
];

describe('parseReleaseRule / serialiseReleaseRule', () => {
  it('parses cycles:N and days:N', () => {
    expect(parseReleaseRule('cycles:2')).toEqual({ mode: 'cycles', n: 2 });
    expect(parseReleaseRule('days:45')).toEqual({ mode: 'days', n: 45 });
  });
  it('defaults unknown / legacy to days:30', () => {
    expect(parseReleaseRule('next_cycle_after_30_days')).toEqual({ mode: 'days', n: 30 });
    expect(parseReleaseRule(null)).toEqual({ mode: 'days', n: 30 });
    expect(parseReleaseRule('garbage')).toEqual({ mode: 'days', n: 30 });
  });
  it('serialises back', () => {
    expect(serialiseReleaseRule('cycles', 3)).toBe('cycles:3');
    expect(serialiseReleaseRule('days', 30)).toBe('days:30');
  });
});

describe('resolveScheduledReleasePeriod — days mode', () => {
  it('first later period whose payday ≥ origin payday + N days', () => {
    // P1 payday 2026-01-30 → +30 = 2026-03-01 → first payday ≥ that is P4 (2026-03-13).
    expect(resolveScheduledReleasePeriod(periods[0], periods, 'days:30')?.id).toBe('P4');
    // +14 days from 2026-01-30 = 2026-02-13 → P2 (payday 2026-02-13, inclusive).
    expect(resolveScheduledReleasePeriod(periods[0], periods, 'days:14')?.id).toBe('P2');
  });
  it('the legacy alias behaves as days:30', () => {
    expect(resolveScheduledReleasePeriod(periods[0], periods, 'next_cycle_after_30_days')?.id).toBe('P4');
  });
  it('returns null when no later period qualifies', () => {
    expect(resolveScheduledReleasePeriod(periods[3], periods, 'days:30')).toBeNull();
  });
});

describe('resolveScheduledReleasePeriod — cycles mode', () => {
  it('cycles:1 → the next period after the origin', () => {
    expect(resolveScheduledReleasePeriod(periods[0], periods, 'cycles:1')?.id).toBe('P2');
  });
  it('cycles:2 → the 2nd period after the origin', () => {
    expect(resolveScheduledReleasePeriod(periods[0], periods, 'cycles:2')?.id).toBe('P3');
  });
  it('returns null when there aren’t N later periods', () => {
    expect(resolveScheduledReleasePeriod(periods[2], periods, 'cycles:2')).toBeNull(); // only P4 is later
  });
});
