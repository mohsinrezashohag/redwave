/**
 * Period generation — the pure calendar logic behind admin-configurable cycles.
 *
 * The genesis calendars are the reference points: pay = anchor 2026-01-04, 14 days, payday +13 (Sun–Sat
 * biweekly); billing = anchor 2026-01-05, 7 days (Mon–Sun). A generalised generator must reproduce both
 * EXACTLY, or changing the config would silently move periods that already exist.
 */
import {
  addDays,
  daysBetween,
  generatePeriods,
  overlappingBillingPeriods,
  periodByNumber,
  periodNumberFor,
  validatePeriodShape,
  type PeriodShape,
} from './period-generation.logic';

const PAY: PeriodShape = { anchorDate: '2026-01-04', lengthDays: 14, paydayOffsetDays: 13 };
const BILLING: PeriodShape = { anchorDate: '2026-01-05', lengthDays: 7 };

describe('period generation reproduces the genesis calendars exactly', () => {
  it('pay period 1 matches the seeded Sun–Sat biweekly shape with payday +13', () => {
    expect(periodByNumber(PAY, 1)).toEqual({
      period_number: 1,
      start_date: '2026-01-04', // Sunday
      end_date: '2026-01-17', // Saturday, 14 days inclusive
      payday: '2026-01-30',
    });
  });

  it('billing period 1 matches the seeded Mon–Sun week and carries NO payday', () => {
    const week = periodByNumber(BILLING, 1);
    expect(week).toEqual({ period_number: 1, start_date: '2026-01-05', end_date: '2026-01-11' });
    expect(week.payday).toBeUndefined(); // a bill is what the client owes, not what a rep is paid
  });

  it('26 pay periods cover the year with no gap and no overlap', () => {
    const periods = generatePeriods(PAY, 1, 26);
    expect(periods).toHaveLength(26);
    for (let i = 1; i < periods.length; i += 1) {
      // Each period starts the day after the previous one ends — contiguous by construction.
      expect(periods[i].start_date).toBe(addDays(periods[i - 1].end_date, 1));
    }
  });
});

describe('a date resolves to the right period number', () => {
  it('finds the period containing a date, on both boundaries', () => {
    expect(periodNumberFor(PAY, '2026-01-04')).toBe(1); // first day
    expect(periodNumberFor(PAY, '2026-01-17')).toBe(1); // last day
    expect(periodNumberFor(PAY, '2026-01-18')).toBe(2); // next day rolls over
  });

  it('returns null before the anchor — that period does not exist in this calendar', () => {
    expect(periodNumberFor(PAY, '2026-01-03')).toBeNull();
  });

  /**
   * #7 — a sale's period comes from its sale_date. If a config change moves a boundary, a sale near that
   * boundary must resolve under the NEW shape to the period that actually contains it. This is the check
   * the packet's definition of done calls for.
   */
  it('a sale near a moved boundary resolves to the period that contains it under the new shape', () => {
    const sale = '2026-01-18'; // day 15 from the anchor
    expect(periodNumberFor(PAY, sale)).toBe(2); // 14-day cycle: second period

    const weekly: PeriodShape = { ...PAY, lengthDays: 7 };
    expect(periodNumberFor(weekly, sale)).toBe(3); // 7-day cycle: third period

    // And in both cases the resolved period genuinely contains the sale date.
    for (const shape of [PAY, weekly]) {
      const n = periodNumberFor(shape, sale)!;
      const p = periodByNumber(shape, n);
      expect(sale >= p.start_date && sale <= p.end_date).toBe(true);
    }
  });
});

describe('a bad shape fails loudly rather than generating a broken calendar', () => {
  it('rejects a length of zero or less — periods would overlap or invert', () => {
    expect(validatePeriodShape({ ...PAY, lengthDays: 0 })).toContainEqual(expect.stringContaining('length_days'));
    expect(validatePeriodShape({ ...PAY, lengthDays: -7 })).toContainEqual(expect.stringContaining('length_days'));
  });

  it('rejects a NEGATIVE payday offset — a rep is never paid before the period closes', () => {
    expect(validatePeriodShape({ ...PAY, paydayOffsetDays: -1 })).toContainEqual(
      expect.stringContaining('payday_offset_days'),
    );
  });

  it('accepts a payday offset of zero (paid on close)', () => {
    expect(validatePeriodShape({ ...PAY, paydayOffsetDays: 0 })).toEqual([]);
  });

  it('rejects a malformed anchor', () => {
    expect(validatePeriodShape({ ...PAY, anchorDate: '04-01-2026' })).toContainEqual(
      expect.stringContaining('anchor_date'),
    );
  });

  it('accepts the two genesis shapes', () => {
    expect(validatePeriodShape(PAY)).toEqual([]);
    expect(validatePeriodShape(BILLING)).toEqual([]);
  });
});

/**
 * §14 rule 1 — the two calendars are never substituted for one another. A bill straddles two pay periods,
 * and surfacing that is the point: the packet asks for the overlap to be VISIBLE rather than discovered
 * later by someone chasing a reconciliation that was never going to tie out.
 */
describe('the billing↔pay overlap is visible', () => {
  it('a 14-day pay period spans two billing weeks — one whole, one straddling', () => {
    // Pay 1 = Jan 4–17. Week 1 = Jan 5–11 (whole); week 2 = Jan 12–18 (ends a day late, straddling);
    // week 3 starts Jan 19, after the pay period closed, so it does not overlap.
    const overlaps = overlappingBillingPeriods(PAY, BILLING, 1);
    expect(overlaps.map((o) => o.billing_period_number)).toEqual([1, 2]);
    expect(overlaps.filter((o) => o.fully_inside).map((o) => o.billing_period_number)).toEqual([1]);
  });

  /**
   * The one-day anchor offset made concrete: pay periods start Sunday, billing weeks start Monday, so the
   * FIRST day of pay period 1 (Sunday Jan 4) belongs to no billing week at all — the billing calendar
   * begins the next day. Worth asserting rather than leaving to be noticed during a reconciliation.
   */
  it("the pay period's first day can precede the billing calendar entirely", () => {
    const pay = periodByNumber(PAY, 1);
    const overlaps = overlappingBillingPeriods(PAY, BILLING, 1);
    expect(pay.start_date).toBe('2026-01-04');
    expect(overlaps[0].start_date).toBe('2026-01-05'); // one day later — the offset Redwave wants to control
  });

  it('the straddling week genuinely crosses the pay period boundary', () => {
    const pay = periodByNumber(PAY, 1);
    const straddler = overlappingBillingPeriods(PAY, BILLING, 1).find((o) => !o.fully_inside)!;
    expect(straddler.start_date <= pay.end_date).toBe(true); // starts inside
    expect(straddler.end_date > pay.end_date).toBe(true); // ends outside
  });

  it('every reported week shares at least one day with the pay period', () => {
    const pay = periodByNumber(PAY, 3);
    for (const o of overlappingBillingPeriods(PAY, BILLING, 3)) {
      expect(o.end_date >= pay.start_date && o.start_date <= pay.end_date).toBe(true);
    }
  });

  it('reports nothing when the pay period precedes the billing anchor — a real transition state', () => {
    const lateBilling: PeriodShape = { anchorDate: '2027-01-04', lengthDays: 7 };
    expect(overlappingBillingPeriods(PAY, lateBilling, 1)).toEqual([]);
  });
});

describe('date helpers are exact', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  // DST is why the arithmetic is done at UTC midnight — a local-time date would drift by an hour and
  // could land on the wrong day, putting a sale in the wrong pay period.
  it('daysBetween is unaffected by a DST transition', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // North American spring-forward weekend
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1); // fall-back
  });
});
