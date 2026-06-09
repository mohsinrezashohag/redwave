/**
 * RepDashboardPage — the rep's own-data view (design-system §10.1: calm, motivational, own-data only).
 * KPI tiles (this period's activations + pay composition), tier progress, an activations-by-product chart,
 * the rep's leaderboard standing (counts only), and recent clawbacks. All data is server-scoped to the
 * caller's rep; a 403 (e.g. a user with no linked rep) renders AccessDenied. — SRS §14
 */
import { Badge, Card, PageHeader, StatCard, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { productTypeLabel } from '../../../lib/format/productType';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { useLeaderboard, useRepDashboard } from '../api/useDashboards';
import { ChartContainer } from '../charts/ChartContainer';
import { ThemedBarChart } from '../charts/ThemedBarChart';
import { TierProgressBar } from '../components/TierProgressBar';
import { RecentClawbacks } from '../components/RecentClawbacks';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { AccessDenied } from '../components/AccessDenied';
import { isForbidden } from '../../../lib/api/apiError';
import styles from '../dashboards.module.css';

export default function RepDashboardPage() {
  const { repId } = useAuth();
  const q = useRepDashboard();
  const board = useLeaderboard();

  if (isForbidden(q.error)) return <AccessDenied message="This view is for reps with a linked profile." />;

  const d = q.data;
  const myRank = board.data?.rankings.find((r) => r.rep_id === repId);
  const productData = (d?.counts_by_product ?? []).map((c) => ({
    product: productTypeLabel(c.product_type),
    count: c.count,
  }));

  return (
    <div className={styles.page}>
      <PageHeader
        title="My dashboard"
        subtitle={d?.period ? `Pay period ${d.period.period_number}` : 'No open pay period'}
      />
      <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
        {d && (
          <>
            <div className={styles.kpiGrid}>
              <StatCard label="Internet activations" value={d.internet_activations} footnote="Counts toward your tier" />
              <StatCard label="Estimated commission" value={money(d.commission.commission_70)} footnote="70% advance this period" />
              <StatCard label="Net payout (period)" value={money(d.commission.net_payout)} footnote="After holdback + adjustments" />
              <StatCard label="Holdback pending" value={money(d.holdback_pending_release)} footnote="Releases on schedule" />
              <StatCard
                label="Target progress"
                value={`${d.target.actual} / ${d.target.target_activations ?? '—'}`}
                footnote={d.target.to_go != null ? `${d.target.to_go} activations to go` : 'No target set'}
              />
            </div>

            <div className={styles.cols}>
              <Card title="Activations by product">
                {productData.length > 0 ? (
                  <ChartContainer height={260}>
                    <ThemedBarChart data={productData} categoryKey="product" valueKey="count" />
                  </ChartContainer>
                ) : (
                  <p className="mono">No activations yet this period.</p>
                )}
              </Card>
              <Card title="Tier progress">
                <TierProgressBar tier={d.tier} />
              </Card>
            </div>

            <Card title="Recent sales">
              {d.recent_sales.length === 0 ? (
                <p className="mono">No sales yet.</p>
              ) : (
                <Table density="dense">
                  <THead>
                    <TR>
                      <TH>Sale</TH>
                      <TH>Customer</TH>
                      <TH>Status</TH>
                      <TH>Greenfield</TH>
                      <TH align="right">Date</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {d.recent_sales.map((s) => (
                      <TR key={s.id}>
                        <TD className="mono">{s.sale_code}</TD>
                        <TD>{s.customer_name}</TD>
                        <TD>
                          <Badge tone="neutral">{s.status.replace(/_/g, ' ')}</Badge>
                        </TD>
                        <TD>{s.is_greenfield ? <Badge tone="success">Greenfield</Badge> : <span aria-hidden>—</span>}</TD>
                        <TD align="right" className="mono">{displayDate(s.sale_date)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>

            <div className={styles.cols}>
              <Card title="Recent clawbacks">
                <RecentClawbacks rows={d.recent_clawbacks} />
              </Card>
              <Card title="Leaderboard standing">
                <DataState
                  isLoading={board.isLoading}
                  isError={board.isError}
                  isEmpty={(board.data?.rankings.length ?? 0) === 0}
                  onRetry={() => board.refetch()}
                  emptyNode={<p className="mono">No ranked activity yet.</p>}
                >
                  {myRank && (
                    <StatCard
                      label="Your rank"
                      value={`#${myRank.rank}`}
                      footnote={`${myRank.activation_count} internet activations`}
                    />
                  )}
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <LeaderboardTable rows={board.data?.rankings ?? []} highlightRepId={repId} maxRows={5} />
                  </div>
                </DataState>
              </Card>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}
