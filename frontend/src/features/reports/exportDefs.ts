/**
 * exportDefs — PURE column/filename definitions for the on-demand report exports (/reports/exports).
 * One entry per report type: label, the EXISTING permission it rides (mirrors the server's per-type gate
 * — no new permission), and the ExportColumn defs the shared `exportRows` helper consumes. Money is
 * display-only formatting of server decimal strings (#1 — no arithmetic); the leaderboard columns carry
 * NO money, ever. The business summary is scalars → pivoted to metric/value rows. — SRS RPT-015
 */
import type { components } from '../../api/generated/schema';
import type { ExportColumn } from '../../lib/export/exportRows';
import { money } from '../../lib/format/money';
import { displayDate } from '../../lib/format/date';
import type { ReportType } from './reports.types';

type BusinessDashboard = components['schemas']['BusinessDashboardResponse'];
type LeaderboardRow = components['schemas']['LeaderboardRowResponse'];
type PayRunLine = components['schemas']['PayRunLineResponse'];
type ExpenseItem = components['schemas']['ExpenseItemResponse'];

export interface ReportTypeDef {
  type: ReportType;
  label: string;
  description: string;
  /** The EXISTING permission this type rides (same map the server enforces). */
  permission: string;
  /** Which scope inputs the page shows. */
  scope: 'period' | 'date-range' | 'none';
}

export const REPORT_TYPE_DEFS: ReportTypeDef[] = [
  {
    type: 'business_summary',
    label: 'Business summary',
    description: 'Org-wide financials for a pay period (revenue, payout, margin, holdback, clawback, expenses).',
    permission: 'reports:business',
    scope: 'period',
  },
  {
    type: 'leaderboard',
    label: 'Leaderboard standings',
    description: 'Current-period activation rankings (counts only — never money).',
    permission: 'reports:view',
    scope: 'none',
  },
  {
    type: 'payrun_summary',
    label: 'Pay-run summary',
    description: 'Per-rep pay components and net for a period’s run (scoped to what you may see).',
    permission: 'payrun:export',
    scope: 'period',
  },
  {
    type: 'expense_summary',
    label: 'Expense summary',
    description: 'Expense items for a date range (scoped: rep = own, manager = roster).',
    permission: 'expenses:export',
    scope: 'date-range',
  },
];

/** `report-business-summary-2026-06-11` etc. — exportRows appends the extension. */
export function exportFilename(type: ReportType, todayIso: string): string {
  return `report-${type.replace(/_/g, '-')}-${todayIso}`;
}

// ── Leaderboard (counts ONLY — no money column) ─────────────────────────────────────
export const leaderboardColumns: ExportColumn<LeaderboardRow>[] = [
  { header: 'Rank', value: (r) => String(r.rank) },
  { header: 'Rep code', value: (r) => r.rep_code ?? '' },
  { header: 'Rep', value: (r) => r.rep_name ?? '' },
  { header: 'Internet activations', value: (r) => String(r.activation_count) },
];

// ── Pay-run summary (line components + net, as the server computed them) ────────────
export const payrunColumns: ExportColumn<PayRunLine>[] = [
  { header: 'Rep code', value: (l) => l.rep.rep_code },
  { header: 'Rep', value: (l) => l.rep.full_name },
  { header: '70% advance', value: (l) => money(l.commission_70) },
  { header: 'Holdback released', value: (l) => money(l.holdback_release_30) },
  { header: 'Expenses', value: (l) => money(l.expense_total) },
  { header: 'Incentives', value: (l) => money(l.incentive_total) },
  { header: 'Bonus', value: (l) => money(l.bonus_amount) },
  { header: 'Clawbacks', value: (l) => money(l.clawback_total) },
  { header: 'Net payout', value: (l) => money(l.net_payout) },
];

// ── Expense summary (items in range; amounts are server decimal strings) ────────────
export const expenseColumns: ExportColumn<ExpenseItem>[] = [
  { header: 'Date', value: (i) => displayDate(i.expense_date) },
  { header: 'Category', value: (i) => i.category },
  { header: 'Description', value: (i) => i.description },
  { header: 'Status', value: (i) => i.status },
  { header: 'Amount', value: (i) => money(i.amount) },
];

// ── Business summary (period scalars → metric/value rows) ───────────────────────────
export interface MetricRow {
  metric: string;
  value: string;
}

export const businessSummaryColumns: ExportColumn<MetricRow>[] = [
  { header: 'Metric', value: (r) => r.metric },
  { header: 'Value', value: (r) => r.value },
];

/** Pivot the business dashboard's scalars into rows. Pure formatting — no arithmetic (#1). */
export function businessSummaryRows(d: BusinessDashboard): MetricRow[] {
  const rows: MetricRow[] = [
    { metric: 'Period', value: d.period ? `Period ${d.period.period_number}` : 'All time' },
    { metric: 'Revenue (billing stream)', value: money(d.revenue) },
    { metric: 'Rep payout', value: money(d.rep_payout) },
    { metric: 'Net margin', value: money(d.net_margin) },
    { metric: 'Net margin %', value: `${d.net_margin_pct}%` },
    { metric: 'Holdback held', value: money(d.holdback.held) },
    { metric: 'Holdback scheduled', value: money(d.holdback.scheduled) },
    { metric: 'Clawback total', value: money(d.clawback_total) },
    { metric: 'Clawback rate', value: d.clawback_rate },
    { metric: 'Expenses total', value: money(d.expense.total) },
    { metric: 'Expenses — KM', value: money(d.expense.km) },
    { metric: 'Total activations', value: String(d.total_activations) },
    { metric: 'Internet activations (tally)', value: String(d.internet_activations) },
    { metric: 'Greenfield activations', value: String(d.greenfield.count) },
    { metric: 'Greenfield amount', value: money(d.greenfield.amount) },
    { metric: 'Active reps', value: String(d.active_rep_count) },
  ];
  for (const p of d.activations_by_product) {
    rows.push({ metric: `Activations — ${p.label}`, value: String(p.count) });
  }
  return rows;
}
