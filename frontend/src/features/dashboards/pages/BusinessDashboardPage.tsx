/**
 * BusinessDashboardPage — the org-wide executive view (design-system §10.1; SUPER ADMIN ONLY, enforced
 * server-side via reports:business — CLAUDE §5). A period-aware KPI set + breakdowns over the FROZEN ledger
 * (the UI recomputes nothing; every dollar is server-sourced and shown via money()). The period selector
 * defaults to the current period; cross-period trend charts render below. A 403 → AccessDenied. — SRS §14
 */
import { useMemo, useState } from 'react';
import { Badge, Card, PageHeader, Select, StatCard } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { useBusinessDashboard, usePayPeriods } from '../api/useDashboards';
import { ChartContainer } from '../charts/ChartContainer';
import { ThemedBarChart } from '../charts/ThemedBarChart';
import { BusinessTrends } from '../components/BusinessTrends';
import { AccessDenied } from '../components/AccessDenied';
import { isForbidden } from '../../../lib/api/apiError';
import styles from '../dashboards.module.css';

const CURRENT = '__current__';

/** A StatCard delta from a server growth {pct} (null when there's no prior period). */
function growthDelta(g: { pct: string | null } | undefined) {
  if (!g || g.pct == null) return undefined;
  const n = Number(g.pct);
  return { value: `${n >= 0 ? '+' : ''}${g.pct}%`, direction: (n >= 0 ? 'up' : 'down') as 'up' | 'down' };
}
/** A ratio string like "0.0181" → "1.81%". */
const ratePct = (r: string) => `${(Number(r) * 100).toFixed(2)}%`;

export default function BusinessDashboardPage() {
  const canViewPeriods = useCan('payrun:view');
  const periods = usePayPeriods(canViewPeriods);
  const [periodId, setPeriodId] = useState<string | undefined>(undefined);
  const q = useBusinessDashboard({ pay_period_id: periodId });

  const periodOptions = useMemo(
    () => [
      { value: CURRENT, label: 'Current period' },
      ...(periods.data ?? []).map((p) => ({
        value: p.id,
        label: `Period ${p.period_number} · ${displayDate(p.start_date)}–${displayDate(p.end_date)}`,
      })),
    ],
    [periods.data],
  );

  if (isForbidden(q.error)) return <AccessDenied message="The business dashboard is Super Admin only." />;

  const d = q.data;
  const clientRevData = (d?.client_mix ?? []).map((m) => ({ client: m.client_code, revenue: Number(m.revenue) }));
  const productData = (d?.activations_by_product ?? []).map((p) => ({ product: p.label, count: p.count }));

  return (
    <div className={styles.page}>
      <PageHeader
        title="Business overview"
        subtitle="Org-wide financials and activity for the selected pay period. Super Admin only."
        actions={
          canViewPeriods ? (
            <Select aria-label="Pay period" options={periodOptions} value={periodId ?? CURRENT} onValueChange={(v) => setPeriodId(v === CURRENT ? undefined : v)} />
          ) : undefined
        }
      />
      <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
        {d && (
          <>
            {/* ── Headline money ── */}
            <div className={styles.kpiGrid}>
              <StatCard label="Revenue" value={money(d.revenue)} delta={growthDelta(d.revenue_growth)} footnote="Client statements" />
              <StatCard label="Rep payout" value={money(d.rep_payout)} footnote="Pay-run net" />
              <StatCard label="Net margin" value={money(d.net_margin)} footnote={`${d.net_margin_pct}% of revenue`} />
              <StatCard label="Clawbacks" value={money(d.clawback_total)} footnote={`Rate ${ratePct(d.clawback_rate)} of paid commission`} />
              <StatCard label="Expenses" value={money(d.expense.total)} footnote={`KM ${money(d.expense.km)} · Other ${money(d.expense.other)}`} />
            </div>

            {/* ── Activations ── */}
            <div className={styles.kpiGrid}>
              <StatCard label="Total activations" value={d.total_activations} delta={growthDelta(d.activation_growth)} footnote="Confirmed sale items" />
              <StatCard label="Internet activations" value={d.internet_activations} footnote="Excluding greenfield" />
              <StatCard label="Greenfield" value={d.greenfield.count} footnote={`${money(d.greenfield.amount)} flat`} />
              <StatCard label="Active reps" value={d.active_rep_count} footnote="Status = active" />
            </div>

            {/* ── Validation funnel ── */}
            <Card title="Validation funnel">
              <div className={styles.funnel}>
                {[
                  { label: 'Entered', n: d.validation_funnel.entered, tone: 'info' as const },
                  { label: 'Validated', n: d.validation_funnel.validated, tone: 'success' as const },
                  { label: 'In pay run', n: d.validation_funnel.in_pay_run, tone: 'accent' as const },
                  { label: 'Paid', n: d.validation_funnel.paid, tone: 'success' as const },
                ].map((s) => (
                  <div key={s.label} className={styles.funnelStep}>
                    <span className={styles.funnelValue}>{s.n}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                ))}
              </div>
            </Card>

            <div className={styles.chartGrid}>
              <Card title="Activations by product">
                <ChartContainer height={260}>
                  <ThemedBarChart data={productData} categoryKey="product" valueKey="count" />
                </ChartContainer>
              </Card>
              <Card title="Revenue by client">
                <ChartContainer height={260}>
                  <ThemedBarChart data={clientRevData} categoryKey="client" valueKey="revenue" valueFormatter={money} />
                </ChartContainer>
              </Card>
            </div>

            {/* ── Cross-period trends ── */}
            <BusinessTrends />
          </>
        )}
      </DataState>
    </div>
  );
}
