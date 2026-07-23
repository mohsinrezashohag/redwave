import { describe, expect, it } from 'vitest';
import {
  businessSummaryColumns,
  businessSummaryRows,
  exportFilename,
  expenseColumns,
  leaderboardColumns,
  payrunColumns,
  REPORT_TYPE_DEFS,
} from './exportDefs';
import type { components } from '../../api/generated/schema';

type BusinessDashboard = components['schemas']['BusinessDashboardResponse'];

const biz: BusinessDashboard = {
  period: { id: 'p1', period_number: 12, start_date: '2026-05-31', end_date: '2026-06-13' },
  revenue: '12000.00',
  rep_payout: '8000.00',
  net_margin: '4000.00',
  net_margin_pct: '33.3',
  holdback: { held: '3000.00', scheduled: '500.00', released_this_period: '993.00' },
  clawback_total: '145.00',
  clawback_rate: '0.0181',
  expense: { total: '420.00', km: '120.00', other: '300.00' },
  total_activations: 60,
  internet_activations: 48,
  greenfield: { count: 2, amount: '200.00' },
  activations_by_product: [
    { key: 'internet', label: 'Internet', count: 48 },
    { key: 'tv', label: 'TV', count: 8 },
  ],
  activations_by_client: [],
  validation_funnel: { entered: 5, validated: 10, in_pay_run: 0, paid: 45 },
  active_rep_count: 8,
  tier_distribution: [],
  client_mix: [],
  revenue_growth: { current: '12000.00', previous: '10000.00', pct: '20.0' },
  activation_growth: { current: 60, previous: 50, pct: '20.0' },
} as BusinessDashboard;

describe('exportDefs — per-type defs mirror the server gate', () => {
  it('defines all four types with the EXISTING permission each rides (no new permission)', () => {
    expect(REPORT_TYPE_DEFS.map((d) => [d.type, d.permission])).toEqual([
      ['business_summary', 'reports:business'],
      ['leaderboard', 'reports:view'],
      ['payrun_summary', 'payrun:export'],
      ['expense_summary', 'expenses:export'],
    ]);
  });

  it('builds kebab-case dated filenames (extension added by exportRows)', () => {
    // Rides the shared lib/export convention: redwave- prefix + compacted generation date.
    expect(exportFilename('business_summary', '2026-06-11')).toBe('redwave-report-business-summary-20260611');
    expect(exportFilename('payrun_summary', '2026-06-11')).toBe('redwave-report-payrun-summary-20260611');
  });
});

describe('businessSummaryRows — scalars → metric/value rows (pure formatting, no arithmetic)', () => {
  it('pivots the dashboard scalars and formats money for display', () => {
    const rows = businessSummaryRows(biz);
    const byMetric = new Map(rows.map((r) => [r.metric, r.value]));
    expect(byMetric.get('Period')).toBe('Period 12');
    expect(byMetric.get('Revenue (billing stream)')).toBe('$12,000.00');
    expect(byMetric.get('Net margin %')).toBe('33.3%');
    expect(byMetric.get('Internet activations (tally)')).toBe('48');
    expect(byMetric.get('Activations — TV')).toBe('8');
    // every cell is a string (the exportRows contract)
    expect(rows.every((r) => typeof r.metric === 'string' && typeof r.value === 'string')).toBe(true);
  });

  it('labels the all-time scope when period is null', () => {
    const rows = businessSummaryRows({ ...biz, period: null });
    expect(rows[0]).toEqual({ metric: 'Period', value: 'All time' });
  });
});

describe('column defs — string cells; the leaderboard carries NO money', () => {
  it('leaderboard columns are counts/names only', () => {
    const headers = leaderboardColumns.map((c) => c.header.toLowerCase());
    expect(headers.some((h) => /payout|commission|amount|\$|money/.test(h))).toBe(false);
    const row = { rank: 1, rep_id: 'r1', rep_code: 'RW-D-001', rep_name: 'Rep One', activation_count: 20 };
    expect(leaderboardColumns.map((c) => c.value(row))).toEqual(['1', 'RW-D-001', 'Rep One', '20']);
  });

  it('pay-run columns render the server-computed components as display money', () => {
    const line = {
      id: 'l1', pay_run_id: 'run1', rep_id: 'r1',
      rep: { id: 'r1', rep_code: 'RW-D-001', full_name: 'Rep One' },
      commission_70: '2317.00', holdback_release_30: '993.00', expense_total: '45.00',
      incentive_total: '0.00', bonus_amount: '100.00', bonus_note: null,
      clawback_total: '30.00', net_payout: '3425.00',
    } as Parameters<(typeof payrunColumns)[0]['value']>[0];
    expect(payrunColumns.map((c) => c.value(line))).toEqual([
      'RW-D-001', 'Rep One', '$2,317.00', '$993.00', '$45.00', '$0.00', '$100.00', '$30.00', '$3,425.00',
    ]);
  });

  it('expense columns format the date + amount for display', () => {
    const item = {
      id: 'e1', expense_report_id: null, rep_id: 'r1', submitted_by: 'u1', category: 'meals',
      client_id: null, expense_date: '2026-06-02T00:00:00.000Z', amount: '45.00',
      description: 'Client lunch', receipt_url: null, status: 'approved',
      approved_by: null, approved_at: null,
    } as Parameters<(typeof expenseColumns)[0]['value']>[0];
    const cells = expenseColumns.map((c) => c.value(item));
    expect(cells).toContain('meals');
    expect(cells).toContain('$45.00');
    expect(businessSummaryColumns.map((c) => c.header)).toEqual(['Metric', 'Value']);
  });
});
