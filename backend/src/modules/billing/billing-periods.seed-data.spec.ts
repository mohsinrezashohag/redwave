import { generate2026BillingPeriods } from './billing-periods.seed-data';

/** UTC day-of-week: 0 = Sunday … 1 = Monday. */
const dow = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getUTCDay();
const daysBetween = (a: string, b: string) =>
  (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86_400_000;

describe('generate2026BillingPeriods — the client-billing week', () => {
  const periods = generate2026BillingPeriods();

  it('numbers the bills sequentially from 1 ("Bill 17" is the 17th week)', () => {
    expect(periods).toHaveLength(52);
    expect(periods.map((p) => p.period_number)).toEqual(Array.from({ length: 52 }, (_, i) => i + 1));
  });

  it('every week runs MONDAY → SUNDAY', () => {
    for (const p of periods) {
      expect(dow(p.start_date)).toBe(1);
      expect(dow(p.end_date)).toBe(0);
      expect(daysBetween(p.start_date, p.end_date)).toBe(6);
    }
  });

  it('weeks are contiguous with no gap and no overlap', () => {
    for (let i = 1; i < periods.length; i += 1) {
      expect(daysBetween(periods[i - 1].end_date, periods[i].start_date)).toBe(1);
    }
  });

  it('is deliberately NOT the pay-period calendar — pay periods start Sunday and run 14 days', () => {
    expect(periods[0].start_date).toBe('2026-01-05'); // first Monday of 2026
    expect(daysBetween(periods[0].start_date, periods[1].start_date)).toBe(7);
  });

  it('covers the sample workbook week (Mon 2026-06-29 → Sun 2026-07-05)', () => {
    const week = periods.find((p) => p.start_date === '2026-06-29');
    expect(week).toBeDefined();
    expect(week!.end_date).toBe('2026-07-05');
  });

  it('is deterministic', () => {
    expect(generate2026BillingPeriods()).toEqual(periods);
  });
});
