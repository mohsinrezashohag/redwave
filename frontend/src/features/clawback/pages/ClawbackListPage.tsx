/**
 * ClawbackListPage — /clawbacks. Lists clawbacks (rep-scoped server-side) with their pending→applied status
 * and, when applied, the linked pay run. Connects to Pay Run: a pending clawback becomes a deduction → shows
 * applied + the run once a run finalizes. `clawback:view` to see; `clawback:create` to record. 403 →
 * AccessDenied; the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Undo2 } from 'lucide-react';
import { Button, PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { DataState } from '../../../components/data/DataState';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { usePayRuns } from '../../payrun/api/usePayRun';
import { useClawbacks } from '../api/useClawback';
import { ClawbackListTable } from '../components/ClawbackListTable';
import styles from '../components/clawback.module.css';
import type { ClawbackStatus } from '../clawback.types';

const ALL = '__all__';

export default function ClawbackListPage() {
  const canView = useCan('clawback:view');
  const canCreate = useCan('clawback:create');
  const canViewRuns = useCan('payrun:view');
  const navigate = useNavigate();
  const [status, setStatus] = useState<ClawbackStatus | 'all'>('all');

  const q = useClawbacks(status === 'all' ? {} : { status }, canView);
  const runsQ = usePayRuns(canViewRuns);

  const runMap = useMemo(() => new Map((runsQ.data ?? []).map((r) => [r.id, r.display_label])), [runsQ.data]);
  const runLabel = (id: string | null) => (id ? runMap.get(id) ?? 'Applied' : '—');

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing clawbacks requires the clawback view permission." />;
  }

  const rows = q.data ?? [];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Clawbacks"
        subtitle="Recoveries against paid items. A pending clawback is deducted from the rep's next pay run, then shows as applied."
        actions={
          canCreate ? (
            <Button variant="primary" leftIcon={<Undo2 size={16} />} onClick={() => navigate('/clawbacks/new')}>
              Record a clawback
            </Button>
          ) : undefined
        }
      />
      <div className={styles.controls}>
        <div className={styles.control}>
          <Select
            options={[
              { value: ALL, label: 'All statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'applied', label: 'Applied' },
            ]}
            value={status}
            onValueChange={(v) => setStatus(v === ALL ? 'all' : (v as ClawbackStatus))}
            aria-label="Status filter"
          />
        </div>
      </div>
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No clawbacks yet.</p>}
      >
        <ClawbackListTable rows={rows} runLabel={runLabel} />
      </DataState>
    </div>
  );
}
