/**
 * BusinessTrends — the cross-period trend charts (Super Admin). Reads the bounded trends endpoint and pivots
 * its long-format rows into wide series for recharts: a revenue/payout/margin line, activations-by-product
 * stacked area, revenue-by-client line, and tier-distribution stacked area. Charts are token-themed (theme-
 * correct in both modes) and lazy-loaded with the page. The UI computes nothing — money is server-sourced.
 */
import { Card } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { money } from '../../../lib/format/money';
import { productTypeLabel } from '../../../lib/format/productType';
import { useBusinessTrends } from '../api/useDashboards';
import { ChartContainer } from '../charts/ChartContainer';
import { ThemedLineChart, type SeriesDef } from '../charts/ThemedLineChart';
import { ThemedStackedAreaChart } from '../charts/ThemedStackedAreaChart';
import type { ChartRow } from '../charts/ThemedBarChart';
import styles from '../dashboards.module.css';

const pLabel = (n: number) => `P${n}`;

/** Pivot long rows → wide rows (one per period with a column per series) + the distinct series keys. */
function pivot<T extends { period_number: number }>(
  rows: T[],
  keyOf: (r: T) => string,
  valOf: (r: T) => number,
  periodNums: number[],
): { data: ChartRow[]; series: SeriesDef[] } {
  const keys = [...new Set(rows.map(keyOf))];
  const byPeriod = new Map<number, ChartRow>(periodNums.map((p) => [p, { period: pLabel(p) }]));
  for (const r of rows) {
    const row = byPeriod.get(r.period_number);
    if (!row) continue;
    row[keyOf(r)] = Number(row[keyOf(r)] ?? 0) + valOf(r);
  }
  return { data: [...byPeriod.values()], series: keys.sort().map((k) => ({ key: k, label: k })) };
}

export function BusinessTrends({ periods = 6 }: { periods?: number } = {}) {
  const q = useBusinessTrends(periods);
  const t = q.data;
  const periodNums = (t?.periods ?? []).map((p) => p.period_number);

  const headline: ChartRow[] = (t?.periods ?? []).map((p) => ({
    period: pLabel(p.period_number),
    Revenue: Number(p.revenue),
    Payout: Number(p.payout),
    'Net margin': Number(p.net_margin),
  }));
  const headlineSeries: SeriesDef[] = [
    { key: 'Revenue', label: 'Revenue' },
    { key: 'Payout', label: 'Payout' },
    { key: 'Net margin', label: 'Net margin' },
  ];

  const prod = pivot(t?.by_product ?? [], (r) => productTypeLabel(r.product_type), (r) => r.count, periodNums);
  const clientRev = pivot(t?.by_client_revenue ?? [], (r) => r.client_code, (r) => Number(r.amount), periodNums);
  const tier = pivot(t?.tier_distribution ?? [], (r) => `Tier ${r.tier_number}`, (r) => r.rep_count, periodNums);

  return (
    <DataState
      isLoading={q.isLoading}
      isError={q.isError}
      isEmpty={(t?.periods.length ?? 0) === 0}
      onRetry={() => q.refetch()}
      emptyNode={<p className="mono">No trend data yet — finalize a pay run to populate trends.</p>}
    >
      <div className={styles.chartGrid}>
        <Card title="Revenue · payout · margin (recent periods)">
          <ChartContainer height={280}>
            <ThemedLineChart data={headline} categoryKey="period" series={headlineSeries} valueFormatter={money} />
          </ChartContainer>
        </Card>
        <Card title="Activations by product (over time)">
          <ChartContainer height={280}>
            <ThemedStackedAreaChart data={prod.data} categoryKey="period" series={prod.series} />
          </ChartContainer>
        </Card>
        <Card title="Revenue by client (over time)">
          <ChartContainer height={280}>
            <ThemedLineChart data={clientRev.data} categoryKey="period" series={clientRev.series} valueFormatter={money} />
          </ChartContainer>
        </Card>
        <Card title="Tier distribution (over time)">
          <ChartContainer height={280}>
            <ThemedStackedAreaChart data={tier.data} categoryKey="period" series={tier.series} />
          </ChartContainer>
        </Card>
      </div>
    </DataState>
  );
}
