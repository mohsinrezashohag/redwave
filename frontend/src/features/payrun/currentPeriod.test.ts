import { describe, expect, it } from 'vitest';
import { cycleLabel, findCurrentPeriod } from './currentPeriod';
import { todayInWinnipeg } from '../../lib/format/date';

const periods = [
  { period_number: 22, start_date: '2026-10-25T00:00:00.000Z', end_date: '2026-11-07T00:00:00.000Z' },
  { period_number: 23, start_date: '2026-11-08T00:00:00.000Z', end_date: '2026-11-21T00:00:00.000Z' },
];

describe('findCurrentPeriod', () => {
  it('finds the period containing today, inclusive of both ends', () => {
    expect(findCurrentPeriod(periods, '2026-11-11')?.period_number).toBe(23);
    expect(findCurrentPeriod(periods, '2026-11-07')?.period_number).toBe(22);
    expect(findCurrentPeriod(periods, '2026-11-08')?.period_number).toBe(23);
  });

  it('returns null outside the schedule', () => {
    expect(findCurrentPeriod(periods, '2026-11-22')).toBeNull();
  });
});

describe('cycleLabel', () => {
  it('labels with the period number and its day range', () => {
    expect(cycleLabel(periods[1])).toBe('Cycle 23 · Nov 8 – Nov 21');
  });
});

describe('todayInWinnipeg', () => {
  it('uses Winnipeg, not UTC — 23:30 Winnipeg on Nov 7 is already Nov 8 in UTC', () => {
    expect(todayInWinnipeg(new Date('2026-11-08T05:30:00Z'))).toBe('2026-11-07');
  });
});
