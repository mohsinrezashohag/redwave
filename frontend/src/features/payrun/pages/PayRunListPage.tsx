/**
 * PayRunListPage — /pay-runs. The pay-period schedule with each period's run state, the entry point to the
 * draft→review→finalize→export workflow. The UI computes no money; drafting is a backend call that returns
 * the computed run, then we route to the workspace. `payrun:view` to see; `payrun:create` to draft. 403 →
 * AccessDenied; the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { DataState } from '../../../components/data/DataState';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { PeriodsTable, type PeriodRow } from '../components/PeriodsTable';
import { usePayPeriods, usePayRuns } from '../api/usePayRun';
import { useDraftRun } from '../api/usePayRunMutations';
import type { PayRunSummary } from '../payrun.types';
import styles from '../components/payrun.module.css';

export default function PayRunListPage() {
  const canView = useCan('payrun:view');
  const canCreate = useCan('payrun:create');
  const navigate = useNavigate();
  const onError = useApiErrorToast();

  const periodsQ = usePayPeriods(canView);
  const runsQ = usePayRuns(canView);
  const draft = useDraftRun();
  const [draftingPeriodId, setDraftingPeriodId] = useState<string | null>(null);

  // Join each period with its latest run (runs come created_at-desc → first match is newest). Newest period first.
  const rows = useMemo<PeriodRow[]>(() => {
    const latest = new Map<string, PayRunSummary>();
    for (const run of runsQ.data ?? []) {
      if (!latest.has(run.pay_period_id)) latest.set(run.pay_period_id, run);
    }
    return (periodsQ.data ?? [])
      .map((period) => ({ period, run: latest.get(period.id) ?? null }))
      .sort((a, b) => b.period.period_number - a.period.period_number);
  }, [periodsQ.data, runsQ.data]);

  if (!canView || isForbidden(periodsQ.error) || isForbidden(runsQ.error)) {
    return <AccessDenied message="Viewing pay runs requires the pay-run view permission." />;
  }

  const onDraft = (periodId: string) => {
    setDraftingPeriodId(periodId);
    draft.mutate(
      { pay_period_id: periodId },
      {
        onSuccess: (run) => navigate(`/pay-runs/${run.id}`),
        onError: (err) => {
          setDraftingPeriodId(null);
          onError(err);
        },
      },
    );
  };

  const isLoading = periodsQ.isLoading || runsQ.isLoading;
  const isError = periodsQ.isError || runsQ.isError;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Pay Run"
        subtitle="Draft, review, and finalize bi-weekly pay. Every amount is computed by the engine and the pay-run service. This screen is for reviewing and finalizing."
      />
      <DataState
        isLoading={isLoading}
        isError={isError}
        isEmpty={rows.length === 0}
        onRetry={() => {
          periodsQ.refetch();
          runsQ.refetch();
        }}
        emptyNode={<p className="mono">No pay periods are loaded.</p>}
      >
        <PeriodsTable rows={rows} canCreate={canCreate} draftingPeriodId={draftingPeriodId} onOpen={(id) => navigate(`/pay-runs/${id}`)} onDraft={onDraft} />
      </DataState>
    </div>
  );
}
