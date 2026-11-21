import { DomainError } from '../../common/errors/domain-error';
import { isoDate, parseIsoDate, parseRange, runDisplayLabel, uncoveredSpans, windowOfRun } from './run-window.logic';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const spans = (list: { from: Date; to: Date }[]) => list.map((s) => `${isoDate(s.from)}..${isoDate(s.to)}`);

describe('run-window.logic — what a commission report covers (client decision 2026-11-16)', () => {
  describe('parseIsoDate', () => {
    it('parses a real calendar date at UTC midnight', () => {
      expect(parseIsoDate('2026-11-03')?.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    });
    it.each(['2026-02-30', '2026-13-01', '26-11-03', '2026-11-3', 'nope', ''])('rejects %p', (v) => {
      expect(parseIsoDate(v)).toBeNull();
    });
  });

  describe('parseRange', () => {
    it('accepts from ≤ to, including a one-day range', () => {
      expect(parseRange('2026-11-01', '2026-11-14')).toEqual({ from: d('2026-11-01'), to: d('2026-11-14') });
      expect(parseRange('2026-11-05', '2026-11-05')).toEqual({ from: d('2026-11-05'), to: d('2026-11-05') });
    });
    it('rejects a reversed range as a client fault (422 DomainError)', () => {
      expect(() => parseRange('2026-11-14', '2026-11-01')).toThrow(DomainError);
    });
    it('rejects an impossible date as a client fault', () => {
      expect(() => parseRange('2026-02-30', '2026-03-01')).toThrow(DomainError);
    });
  });

  describe('windowOfRun', () => {
    const period = { id: 'P6', period_number: 6, start_date: d('2026-03-01'), end_date: d('2026-03-14') };

    it('a legacy run covers its pay period and is never client/rep-limited', () => {
      const w = windowOfRun({
        pay_period_id: 'P6',
        pay_period: period,
        date_from: null,
        date_to: null,
        client_id: 'C1',
        rep_id: 'R1',
      });
      expect(w).toEqual({
        kind: 'period',
        from: period.start_date,
        to: period.end_date,
        clientId: null,
        repId: null,
        payPeriodId: 'P6',
        periodNumber: 6,
      });
    });

    it('a range run covers its sale-date range with its optional client and rep', () => {
      const w = windowOfRun({
        pay_period_id: null,
        pay_period: null,
        date_from: d('2026-11-01'),
        date_to: d('2026-11-14'),
        client_id: 'C1',
        rep_id: null,
      });
      expect(w).toMatchObject({ kind: 'range', clientId: 'C1', repId: null, payPeriodId: null, periodNumber: null });
      expect(isoDate(w.from)).toBe('2026-11-01');
      expect(isoDate(w.to)).toBe('2026-11-14');
    });

    it('a row with neither a period nor a range is a server fault (bare Error, not a 422)', () => {
      let thrown: unknown;
      try {
        windowOfRun({ pay_period_id: null, date_from: null, date_to: null, client_id: null, rep_id: null });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(DomainError);
    });
  });

  describe('runDisplayLabel', () => {
    const range = windowOfRun({
      pay_period_id: null,
      date_from: d('2026-11-01'),
      date_to: d('2026-11-14'),
      client_id: null,
      rep_id: null,
    });
    const legacy = windowOfRun({
      pay_period_id: 'P6',
      pay_period: { id: 'P6', period_number: 6, start_date: d('2026-03-01'), end_date: d('2026-03-14') },
      date_from: null,
      date_to: null,
      client_id: null,
      rep_id: null,
    });

    it('prefers the admin label (trimmed)', () => {
      expect(runDisplayLabel(range, '  November first half ')).toBe('November first half');
    });
    it('falls back to "Pay period #N" for a legacy run', () => {
      expect(runDisplayLabel(legacy, null)).toBe('Pay period #6');
    });
    it('falls back to the date range for a range run (blank label ignored)', () => {
      expect(runDisplayLabel(range, '   ')).toBe('2026-11-01 to 2026-11-14');
    });
  });

  describe('uncoveredSpans — so overlapping reports never reimburse an expense twice', () => {
    const span = { from: d('2026-11-01'), to: d('2026-11-30') };

    it('returns the whole span when nothing covers it', () => {
      expect(spans(uncoveredSpans(span, []))).toEqual(['2026-11-01..2026-11-30']);
    });
    it('returns nothing when it is fully covered', () => {
      expect(uncoveredSpans(span, [{ from: d('2026-10-15'), to: d('2026-12-05') }])).toEqual([]);
    });
    it('cuts out a covered middle, inclusive on both edges', () => {
      expect(spans(uncoveredSpans(span, [{ from: d('2026-11-10'), to: d('2026-11-14') }]))).toEqual([
        '2026-11-01..2026-11-09',
        '2026-11-15..2026-11-30',
      ]);
    });
    it('merges overlapping and unsorted covers and ignores ones outside the span', () => {
      const covered = [
        { from: d('2026-11-20'), to: d('2026-11-25') },
        { from: d('2026-10-01'), to: d('2026-10-31') },
        { from: d('2026-11-05'), to: d('2026-11-12') },
        { from: d('2026-11-10'), to: d('2026-11-21') },
      ];
      expect(spans(uncoveredSpans(span, covered))).toEqual(['2026-11-01..2026-11-04', '2026-11-26..2026-11-30']);
    });
    it('handles a cover touching the first and last day', () => {
      const covered = [
        { from: d('2026-11-01'), to: d('2026-11-01') },
        { from: d('2026-11-30'), to: d('2026-11-30') },
      ];
      expect(spans(uncoveredSpans(span, covered))).toEqual(['2026-11-02..2026-11-29']);
    });
  });
});
