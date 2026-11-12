/**
 * LeaderboardPage — the company-wide COUNTS-ONLY ranking (CLAUDE §5: counts only, never peer earnings).
 * A ranked table + a horizontal bar chart of internet-activation counts. No dollar amounts anywhere.
 * Visible to anyone with reports:view. — SRS §14
 */
import { PageHeader, Card } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { useLeaderboard } from '../api/useDashboards';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../components/AccessDenied';
import { ChartContainer } from '../charts/ChartContainer';
import { ThemedBarChart } from '../charts/ThemedBarChart';
import { LeaderboardTable } from '../components/LeaderboardTable';
import styles from '../dashboards.module.css';

export default function LeaderboardPage() {
  const { repId } = useAuth();
  const q = useLeaderboard();
  const rows = q.data?.rankings ?? [];
  if (isForbidden(q.error)) {
    return <AccessDenied message="The leaderboard needs the reports view permission." />;
  }
  const chartData = rows.slice(0, 10).map((r) => ({
    rep: r.rep_name ?? r.rep_code ?? `#${r.rank}`,
    activations: r.activation_count,
  }));

  return (
    <div className={styles.page}>
      <PageHeader
        title="Leaderboard"
        subtitle={q.data?.period ? `Pay period ${q.data.period.period_number} · internet activations` : 'Internet activations'}
      />
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<Card title="Leaderboard"><p className="mono">No ranked activity yet this period.</p></Card>}
      >
        <div className={styles.cols}>
          <Card title="Top reps by activations">
            <ChartContainer height={Math.max(220, chartData.length * 34)}>
              <ThemedBarChart
                data={chartData}
                categoryKey="rep"
                valueKey="activations"
                orientation="vertical"
                uniformColor="var(--chart-1)"
              />
            </ChartContainer>
          </Card>
          <Card title="Full ranking">
            <LeaderboardTable rows={rows} highlightRepId={repId} />
          </Card>
        </div>
      </DataState>
    </div>
  );
}
