/**
 * LeaderboardPage — the company-wide COUNTS-ONLY ranking (CLAUDE §5: counts only, never peer earnings).
 * A ranked table + a stacked bar chart of APPROVED and PENDING internet activations per rep, each in its own
 * colour (client meeting 2026-11-16), series labelled directly (§13.7). No dollar amounts anywhere.
 * Visible to anyone with reports:view. — SRS §14
 */
import { PageHeader, Card } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { useLeaderboard } from '../api/useDashboards';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../components/AccessDenied';
import { ChartContainer } from '../charts/ChartContainer';
import { LeaderboardChart, type LeaderboardChartRow } from '../components/LeaderboardChart';
import { LeaderboardTable } from '../components/LeaderboardTable';
import styles from '../dashboards.module.css';

export default function LeaderboardPage() {
  const { repId } = useAuth();
  const q = useLeaderboard();
  const rows = q.data?.rankings ?? [];
  if (isForbidden(q.error)) {
    return <AccessDenied message="The leaderboard needs the reports view permission." />;
  }
  const chartData: LeaderboardChartRow[] = rows.slice(0, 10).map((r) => ({
    rep: r.rep_name ?? r.rep_code ?? `#${r.rank}`,
    approved: r.approved_count,
    pending: r.pending_count,
  }));

  return (
    <div className={styles.page}>
      <PageHeader
        title="Leaderboard"
        subtitle={
          q.data?.period
            ? `Pay period ${q.data.period.period_number} · approved and pending internet activations`
            : 'Approved and pending internet activations'
        }
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
              <LeaderboardChart data={chartData} />
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
