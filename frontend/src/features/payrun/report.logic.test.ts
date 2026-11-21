import { describe, expect, it } from 'vitest';
import {
  ALL,
  NEW_REPORT_DEFAULTS,
  fileSource,
  fromSentinel,
  newReportSchema,
  payrollDownloadPath,
  refreshBody,
  scopeLabel,
  toCreateBody,
} from './report.logic';
import type { PayRunSummary } from './payrun.types';

const range = {
  id: 'run-1',
  kind: 'range',
  display_label: '2026-11-01 to 2026-11-14',
  label: null,
  window_start: '2026-11-01',
  window_end: '2026-11-14',
  pay_period_id: null,
  pay_period: null,
  date_from: '2026-11-01T00:00:00.000Z',
  date_to: '2026-11-14T00:00:00.000Z',
  client_id: 'c1',
  client: { id: 'c1', client_code: 'VF', name: 'Valley Fiber' },
  rep_id: null,
  scope_rep: null,
  status: 'draft',
} as unknown as PayRunSummary;

const legacy = {
  ...range,
  kind: 'period',
  display_label: 'Pay period #6',
  pay_period_id: 'P6',
  pay_period: { id: 'P6', period_number: 6, start_date: '2026-03-01', end_date: '2026-03-14', payday: '2026-03-27' },
  client_id: null,
  client: null,
} as unknown as PayRunSummary;

describe('commission report form (client decision 2026-11-16)', () => {
  it('requires both dates', () => {
    const r = newReportSchema.safeParse(NEW_REPORT_DEFAULTS);
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['date_from', 'date_to']));
  });

  it('rejects an end date before the start date, on the end-date field', () => {
    const r = newReportSchema.safeParse({ ...NEW_REPORT_DEFAULTS, date_from: '2026-11-14', date_to: '2026-11-01' });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['date_to']);
  });

  it('accepts a one-day range', () => {
    expect(newReportSchema.safeParse({ ...NEW_REPORT_DEFAULTS, date_from: '2026-11-05', date_to: '2026-11-05' }).success).toBe(true);
  });

  it('builds the body with only the fields that are set ("All" is never sent)', () => {
    expect(toCreateBody({ ...NEW_REPORT_DEFAULTS, date_from: '2026-11-01', date_to: '2026-11-14', label: '  ' })).toEqual({
      date_from: '2026-11-01',
      date_to: '2026-11-14',
    });
    expect(
      toCreateBody({ date_from: '2026-11-01', date_to: '2026-11-14', client_id: 'c1', rep_id: 'r1', label: ' Nov A ' }),
    ).toEqual({ date_from: '2026-11-01', date_to: '2026-11-14', client_id: 'c1', rep_id: 'r1', label: 'Nov A' });
  });

  it('maps the sentinel to undefined', () => {
    expect(fromSentinel(ALL)).toBeUndefined();
    expect(fromSentinel('')).toBeUndefined();
    expect(fromSentinel('x')).toBe('x');
  });
});

describe('refreshing a draft re-sends its own window', () => {
  it('a range draft refreshes by its range, client and rep', () => {
    expect(refreshBody(range)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-14', client_id: 'c1' });
  });
  it('a legacy draft refreshes by its pay period', () => {
    expect(refreshBody(legacy)).toEqual({ pay_period_id: 'P6' });
  });
});

describe('labels and file names', () => {
  it('describes what a report covers', () => {
    expect(scopeLabel(range)).toBe('Valley Fiber · All reps');
    expect(scopeLabel(legacy)).toBe('Pay period');
  });
  it('names downloads by the period or the range', () => {
    expect(fileSource(range, 'payrun-adp')).toBe('payrun-adp-2026-11-01_2026-11-14');
    expect(fileSource(legacy, 'payrun-adp')).toBe('payrun-adp-period-6');
  });
  it('builds the payroll download path with only the set filters', () => {
    expect(payrollDownloadPath('run-1')).toBe('/v1/pay-runs/run-1/payroll-report/download');
    expect(payrollDownloadPath('run-1', 'c1', 'r1')).toBe('/v1/pay-runs/run-1/payroll-report/download?client_id=c1&rep_id=r1');
    expect(payrollDownloadPath('run-1', undefined, 'r1')).toBe('/v1/pay-runs/run-1/payroll-report/download?rep_id=r1');
  });
});
