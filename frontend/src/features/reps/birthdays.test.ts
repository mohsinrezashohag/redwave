import { describe, expect, it } from 'vitest';
import { birthdayDate, birthdayWhen } from './birthdays';

describe('birthday display', () => {
  it('says when', () => {
    expect(birthdayWhen(0)).toBe('Today');
    expect(birthdayWhen(1)).toBe('Tomorrow');
    expect(birthdayWhen(12)).toBe('In 12 days');
  });
  it('formats the calendar day without a timezone shift', () => {
    expect(birthdayDate('2026-11-20')).toMatch(/Nov\.? 20/);
    expect(birthdayDate('2026-11-20')).toMatch(/Fri/);
    expect(birthdayDate('bad')).toBe('bad');
  });
});
