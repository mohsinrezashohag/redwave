/**
 * PayRunDetailPage — /pay-runs/:id. The draft → review → finalize → export workspace. Every amount is the
 * server's (engine-computed); this page reviews and commits, computing no money (#1/#5). Draft shows a
 * "not finalized" banner and allows bonus + recompute + finalize; once finalized the run is LOCKED and
 * read-only (the UI mirrors the backend's #8 guarantee — re-finalize is a no-op so it isn't offered).
 * payrun:view to see; approve/export gate the actions; the server is the real gate (§5).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, FileDown, Lock, RefreshCw } from 'lucide-react';
import { Banner, Button, PageHeader, StatCard, TableError, TableSkeleton, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { downloadFile } from '../../../lib/api/downloadFile';
import { money, sumMoney } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useHoldbackSummary, usePayPeriods, usePayRun } from '../api/usePayRun';
import { useDraftRun } from '../api/usePayRunMutations';
import { PayRunStatusBadge } from '../components/PayRunStatusBadge';
import { PayRunLinesTable } from '../components/PayRunLinesTable';
import { LineBreakdownDrawer } from '../components/LineBreakdownDrawer';
import { RepStatementDrawer } from '../components/RepStatementDrawer';
import { HoldbackPanel } from '../components/HoldbackPanel';
import { HoldbackSummaryPanel } from '../components/HoldbackSummaryPanel';
import { BonusModal } from '../components/BonusModal';
import { FinalizeConfirmModal } from '../components/FinalizeConfirmModal';
import { ExportModal } from '../components/ExportModal';
import { NetPayoutCell } from '../components/NetPayoutCell';
import styles from '../components/payrun.module.css';

export default function PayRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canView = useCan('payrun:view');
  const canApprove = useCan('payrun:approve');
  const canExport = useCan('payrun:export');
  const canCreate = useCan('payrun:create');
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [statementRepId, setStatementRepId] = useState<string | null>(null);

  /**
   * Redwave's own payroll workbook, streamed from the lines FROZEN at finalize. Offered only on a
   * finalized run — before that there are no frozen lines and nothing is owed, so an empty sheet would
   * misrepresent the state rather than reflect it.
   */
  const onPayrollReport = async () => {
    setPayrollBusy(true);
    try {
      await downloadFile(`/v1/pay-runs/${id}/payroll-report/download`);
      toast({ title: 'Payroll report downloaded', tone: 'success' });
    } catch (e) {
      onError(e);
    } finally {
      setPayrollBusy(false);
    }
  };

  const runQ = usePayRun(id, canView);
  const periodsQ = usePayPeriods(canView);
  const holdbackQ = useHoldbackSummary(id, canView); // server-computed 30% view (no UI aggregation)
  const draft = useDraftRun();

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [bonusLineId, setBonusLineId] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  if (!canView || isForbidden(runQ.error)) {
    return <AccessDenied message="Viewing pay runs requires the pay-run view permission." />;
  }
  if (runQ.isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Pay Run" />
        <TableSkeleton rows={6} columns={8} />
      </div>
    );
  }
  const run = runQ.data;
  if (runQ.isError || !run) {
    return (
      <div className={styles.page}>
        <PageHeader title="Pay Run" />
        <TableError message="Couldn't load this pay run." onRetry={() => runQ.refetch()} />
      </div>
    );
  }

  const isDraft = run.status === 'draft';
  const isExported = run.status === 'exported';
  const lines = run.lines;
  const periods = periodsQ.data ?? [];
  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;
  const bonusLine = lines.find((l) => l.id === bonusLineId) ?? null;
  const totalAdvance = sumMoney(lines.map((l) => l.commission_70));
  const totalNet = sumMoney(lines.map((l) => l.net_payout));

  const onRecompute = () =>
    draft.mutate(
      { pay_period_id: run.pay_period_id },
      { onSuccess: () => toast({ title: 'Draft recomputed', tone: 'success' }), onError },
    );

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.runHead}>
            Pay Run · <span className="mono">#{run.pay_period.period_number}</span>
            <PayRunStatusBadge status={run.status} />
          </span>
        }
        subtitle={`${displayDate(run.pay_period.start_date)} – ${displayDate(run.pay_period.end_date)} · payday ${displayDate(run.pay_period.payday)}`}
        actions={
          <>
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate('/pay-runs')}>
              Pay runs
            </Button>
            {isDraft && canCreate && (
              <Button variant="secondary" leftIcon={<RefreshCw size={16} />} loading={draft.isPending} onClick={onRecompute}>
                Recompute
              </Button>
            )}
            {isDraft && canApprove && (
              <Button variant="primary" leftIcon={<Lock size={16} />} onClick={() => setFinalizeOpen(true)}>
                Finalize
              </Button>
            )}
            {!isDraft && canExport && (
              <Button
                variant="secondary"
                leftIcon={<FileSpreadsheet size={16} />}
                loading={payrollBusy}
                onClick={onPayrollReport}
              >
                Payroll report
              </Button>
            )}
            {!isDraft && canExport && (
              <Button variant="primary" leftIcon={<FileDown size={16} />} onClick={() => setExportOpen(true)}>
                Export
              </Button>
            )}
          </>
        }
      />

      {isDraft ? (
        <Banner tone="info" title="Draft — not finalized">
          These amounts are a preview computed by the engine. Nothing is committed until you finalize.
        </Banner>
      ) : (
        <Banner tone="success" title={isExported ? 'Finalized & exported — locked' : 'Finalized — locked'}>
          This run is committed and read-only. Snapshots are frozen, the period&rsquo;s sales are paid, and holdback is recorded.
        </Banner>
      )}

      <div className={styles.summary}>
        <StatCard label="Reps" value={String(lines.length)} />
        <StatCard label="Total 70% advance" value={money(totalAdvance)} />
        {/* The deferred 30% — the SERVER's figure, never a client sum. */}
        <StatCard
          label="Held this period (30%)"
          value={money(holdbackQ.data?.held_this_period)}
          footnote={
            holdbackQ.data?.held_release_period
              ? `Releases into period #${holdbackQ.data.held_release_period.period_number}`
              : undefined
          }
        />
        <StatCard label="Total net payout" value={<NetPayoutCell value={totalNet} />} />
      </div>

      {lines.length === 0 ? (
        <Banner tone="info" title="No lines">
          No reps had validated sales in this period, so there&rsquo;s nothing to pay. Enter and validate sales for this period, then recompute.
        </Banner>
      ) : (
        <PayRunLinesTable
          lines={lines}
          onSelect={(l) => setSelectedLineId(l.id)}
          onBonus={(l) => setBonusLineId(l.id)}
          // Only on a FINALIZED run: the statement reads lines frozen at finalize, so a draft has none.
          onStatement={!isDraft && canExport ? (l) => setStatementRepId(l.rep.id) : undefined}
          canBonus={isDraft && canApprove}
        />
      )}

      <HoldbackSummaryPanel runId={run.id} />

      <HoldbackPanel lines={lines} periods={periods} />

      <RepStatementDrawer
        runId={id ?? ''}
        repId={statementRepId}
        onClose={() => setStatementRepId(null)}
      />

      <LineBreakdownDrawer line={selectedLine} open={selectedLine !== null} onClose={() => setSelectedLineId(null)} isDraft={isDraft} periods={periods} />
      <BonusModal runId={run.id} line={bonusLine} onClose={() => setBonusLineId(null)} />
      <FinalizeConfirmModal runId={run.id} open={finalizeOpen} onClose={() => setFinalizeOpen(false)} />
      <ExportModal runId={run.id} open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
