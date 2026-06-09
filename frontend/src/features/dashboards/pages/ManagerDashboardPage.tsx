/**
 * ManagerDashboardPage — roster aggregates + leaderboard (design-system §10.1). Data is server-scoped to
 * the manager's roster. A manager sees roster AGGREGATE money (payout/holdback) and top performers ranked by
 * activation COUNT; per-rep payout/money-ranking appears ONLY when the caller holds hrm:edit (the server
 * decides — `can_see_rep_money`). Target-vs-actual per rep; a hrm:edit manager can Set targets. 403 (a bare
 * rep with no roster) → AccessDenied. — SRS §14
 */
import { useState } from 'react';
import { CheckSquare, Receipt, UserCog } from 'lucide-react';
import { Badge, Button, Card, PageHeader, StatCard } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { money } from '../../../lib/format/money';
import { useLeaderboard, useManagerDashboard } from '../api/useDashboards';
import { AdminQueueCard } from '../components/AdminQueueCard';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { SetTargetsModal } from '../components/SetTargetsModal';
import { AccessDenied } from '../components/AccessDenied';
import { isForbidden } from '../../../lib/api/apiError';
import styles from '../dashboards.module.css';

export default function ManagerDashboardPage() {
  const q = useManagerDashboard();
  const board = useLeaderboard();
  const canEditTargets = useCan('hrm:edit');
  const [targetsOpen, setTargetsOpen] = useState(false);

  if (isForbidden(q.error)) return <AccessDenied message="The team view needs a roster — you have no reps assigned." />;

  const d = q.data;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Team dashboard"
        subtitle={d?.period ? `Pay period ${d.period.period_number}` : 'No open pay period'}
        actions={canEditTargets && d ? <Button variant="secondary" onClick={() => setTargetsOpen(true)}>Set targets</Button> : undefined}
      />
      <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
        {d && (
          <>
            <div className={styles.kpiGrid}>
              <StatCard label="Team internet activations" value={d.team_internet_activations} footnote="This period, roster-wide" />
              <StatCard label="Sales in period" value={d.sales_in_period} footnote="All products" />
              <StatCard label="Roster size" value={d.roster_size ?? '—'} footnote="Active reps you manage" />
              <StatCard label="Roster payout" value={money(d.roster_payout)} footnote="Roster total (period)" />
              <StatCard label="Roster holdback" value={money(d.roster_holdback)} footnote="Held + scheduled" />
            </div>

            <div className={styles.queueGrid}>
              <AdminQueueCard label="Pending validations" count={d.pending_validations} icon={<CheckSquare size={16} />} to="/sales?status=entered" cta="Review queue" />
              <AdminQueueCard label="Expenses to approve" count={d.pending_expense_approvals} icon={<Receipt size={16} />} to="/expenses/approvals" cta="Review queue" />
              <AdminQueueCard label="Profile changes" count={d.pending_profile_changes} icon={<UserCog size={16} />} to="/admin/profile-review" cta="Review queue" />
            </div>

            <div className={styles.cols}>
              <Card title={`Top performers${d.can_see_rep_money ? '' : ' (by activations)'}`}>
                <div className={styles.rosterList}>
                  {d.top_performers.length === 0 && <p className="mono">No activity yet.</p>}
                  {d.top_performers.map((p) => (
                    <div key={p.rep_id} className={styles.rosterRow}>
                      <span className={styles.rosterName}>{p.rep_name}</span>
                      <span className={`${styles.rosterValue} mono`}>{p.activations} activations</span>
                      {p.payout != null && <Badge tone="neutral">{money(p.payout)}</Badge>}
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Target vs actual">
                <div className={styles.rosterList}>
                  {d.targets.length === 0 && <p className="mono">No reps in your roster.</p>}
                  {d.targets.map((t) => (
                    <div key={t.rep_id} className={styles.rosterRow}>
                      <span className={styles.rosterName}>{t.rep_name}</span>
                      <span className={`${styles.rosterValue} mono`}>
                        {t.actual} / {t.target_activations ?? '—'}
                      </span>
                      {t.target_activations != null && (
                        <Badge tone={t.actual >= t.target_activations ? 'success' : 'warning'}>
                          {t.actual >= t.target_activations ? 'On target' : `${t.target_activations - t.actual} to go`}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card title="Leaderboard (counts only)">
              <DataState
                isLoading={board.isLoading}
                isError={board.isError}
                isEmpty={(board.data?.rankings.length ?? 0) === 0}
                onRetry={() => board.refetch()}
                emptyNode={<p className="mono">No ranked activity yet.</p>}
              >
                <LeaderboardTable rows={board.data?.rankings ?? []} maxRows={10} />
              </DataState>
            </Card>

            <SetTargetsModal open={targetsOpen} onClose={() => setTargetsOpen(false)} periodId={d.period?.id ?? null} rows={d.targets} />
          </>
        )}
      </DataState>
    </div>
  );
}
