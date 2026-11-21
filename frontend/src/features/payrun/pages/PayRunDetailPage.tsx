/**
 * PayRunDetailPage — /pay-runs/:id, one commission report. Client decision 2026-11-16: a report covers a
 * sale-date range (optionally one client and/or one rep); legacy pay-period runs open here too.
 *
 * DRAFT: a server preview. Refresh it, set a bonus, delete it, or "Mark as paid" (the existing finalize,
 * atomic + idempotent server-side, #8). PAID: locked and read-only, with the payroll workbook (client / rep
 * filter) and the ADP file (rep filter). Per-rep totals and the per-sale drill-down are the server's numbers;
 * this page computes no money (#1/#5). Clawbacks are hidden (no deduction is applied).
 * payrun:view to see; create / approve / delete / export gate the actions; the server is the real gate (§5).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, FileSpreadsheet, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { Banner, Button, PageHeader, StatCard, TableError, TableSkeleton, useConfirm, useToast } from '../../../components/ui';
import { ExportMenu } from '../../../components/data/ExportMenu';
import { RecordNotFound } from '../../../components/data/RecordNotFound';
import { useCan } from '../../../auth/useCan';
import { isForbidden, isNotFound, useApiErrorToast } from '../../../lib/api/apiError';
import { money, sumMoney } from '../../../lib/format/money';
import { displayDate, todayIso } from '../../../lib/format/date';
import { exportFilename } from '../../../lib/export/exportFilename';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { usePayRun } from '../api/usePayRun';
import { useDeleteRun, useDraftRun } from '../api/usePayRunMutations';
import { PayRunStatusBadge } from '../components/PayRunStatusBadge';
import { PayRunLinesTable } from '../components/PayRunLinesTable';
import { LineBreakdownDrawer } from '../components/LineBreakdownDrawer';
import { RepStatementDrawer } from '../components/RepStatementDrawer';
import { BonusModal } from '../components/BonusModal';
import { FinalizeConfirmModal } from '../components/FinalizeConfirmModal';
import { ExportModal, type RepChoice } from '../components/ExportModal';
import { PayrollReportModal } from '../components/PayrollReportModal';
import { NetPayoutCell } from '../components/NetPayoutCell';
import { fileSource, refreshBody, scopeLabel } from '../report.logic';
import type { PayRunLine } from '../payrun.types';
import styles from '../components/payrun.module.css';

/** The per-rep totals as a file: server strings only (money columns are numbers in CSV/Excel, #1). */
const LINE_COLUMNS: ExportColumn<PayRunLine>[] = [
  { header: 'Rep code', value: (l) => l.rep.rep_code },
  { header: 'Rep', value: (l) => l.rep.full_name },
  { header: 'Commission', value: (l) => l.commission, money: true },
  { header: 'Incentives', value: (l) => l.incentive_total, money: true },
  { header: 'Expenses', value: (l) => l.expense_total, money: true },
  { header: 'Bonus', value: (l) => l.bonus_amount, money: true },
  { header: 'Net payout', value: (l) => l.net_payout, money: true },
];

export default function PayRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { confirm, dialog } = useConfirm();
  const canView = useCan('payrun:view');
  const canApprove = useCan('payrun:approve');
  const canExport = useCan('payrun:export');
  const canCreate = useCan('payrun:create');
  const canDelete = useCan('payrun:delete');

  const runQ = usePayRun(id, canView);
  const draft = useDraftRun();
  const del = useDeleteRun();

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [bonusLineId, setBonusLineId] = useState<string | null>(null);
  const [statementRepId, setStatementRepId] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [payrollOpen, setPayrollOpen] = useState(false);

  if (!canView || isForbidden(runQ.error)) {
    return <AccessDenied message="Viewing commission reports requires the pay-run view permission." />;
  }
  if (isNotFound(runQ.error)) {
    return <RecordNotFound what="commission report" backTo="/pay-runs" backLabel="Back to commission reports" />;
  }
  if (runQ.isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Commission report" />
        <TableSkeleton rows={6} columns={7} />
      </div>
    );
  }
  const run = runQ.data;
  if (runQ.isError || !run) {
    return (
      <div className={styles.page}>
        <PageHeader title="Commission report" />
        <TableError message="Couldn't load this report." onRetry={() => runQ.refetch()} />
      </div>
    );
  }

  const isDraft = run.status === 'draft';
  const lines = run.lines;
  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;
  const bonusLine = lines.find((l) => l.id === bonusLineId) ?? null;
  const repChoices: RepChoice[] = lines.map((l) => ({ id: l.rep.id, code: l.rep.rep_code, label: `${l.rep.full_name} (${l.rep.rep_code})` }));
  const subtitle =
    run.kind === 'period' && run.pay_period
      ? `Sale dates ${displayDate(run.window_start)} to ${displayDate(run.window_end)} · payday ${displayDate(run.pay_period.payday)}`
      : `Sale dates ${displayDate(run.window_start)} to ${displayDate(run.window_end)} · ${scopeLabel(run)}`;

  const onRefresh = () =>
    draft.mutate(refreshBody(run), {
      onSuccess: () => toast({ title: 'Report refreshed', tone: 'success' }),
      onError,
    });

  const onDelete = () =>
    confirm({
      title: 'Delete this draft report?',
      description: 'Nothing has been paid from it, so no money or sale changes. You can generate it again later.',
      confirmLabel: 'Delete draft',
      onConfirm: () =>
        del.mutate(run.id, {
          onSuccess: () => {
            toast({ title: 'Draft report deleted', tone: 'success' });
            navigate('/pay-runs');
          },
          onError,
        }),
    });

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.runHead}>
            {run.display_label}
            <PayRunStatusBadge status={run.status} />
          </span>
        }
        subtitle={subtitle}
        actions={
          <div className={styles.headerActions}>
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate('/pay-runs')}>
              Reports
            </Button>
            {lines.length > 0 && (
              <ExportMenu
                filename={exportFilename({ source: fileSource(run, 'commission-report'), generatedOn: todayIso() })}
                title={`Commission report, ${run.display_label}`}
                columns={LINE_COLUMNS}
                getRows={() => lines}
              />
            )}
            {isDraft && canCreate && (
              <Button variant="secondary" leftIcon={<RefreshCw size={16} />} loading={draft.isPending} onClick={onRefresh}>
                Refresh
              </Button>
            )}
            {isDraft && canDelete && (
              <Button variant="secondary" leftIcon={<Trash2 size={16} />} loading={del.isPending} onClick={onDelete}>
                Delete draft
              </Button>
            )}
            {isDraft && canApprove && (
              <Button
                variant="primary"
                leftIcon={<Lock size={16} />}
                disabled={lines.length === 0}
                onClick={() => setFinalizeOpen(true)}
              >
                Mark as paid
              </Button>
            )}
            {!isDraft && canExport && (
              <Button variant="secondary" leftIcon={<FileSpreadsheet size={16} />} onClick={() => setPayrollOpen(true)}>
                Payroll report
              </Button>
            )}
            {!isDraft && canExport && (
              <Button variant="primary" leftIcon={<FileDown size={16} />} onClick={() => setExportOpen(true)}>
                ADP export
              </Button>
            )}
          </div>
        }
      />

      {isDraft ? (
        <Banner tone="info" title="Draft, not paid yet">
          These amounts are a preview at the rates in force on each sale date. Nothing is frozen until you mark the
          report as paid.
        </Banner>
      ) : (
        <Banner tone="success" title={run.status === 'exported' ? 'Paid, exported and locked' : 'Paid and locked'}>
          This report is read-only. Its rates are frozen and its sales are marked paid.
        </Banner>
      )}

      <div className={styles.summary}>
        <StatCard label="Reps" value={String(lines.length)} />
        <StatCard label="Total commission" value={money(sumMoney(lines.map((l) => l.commission)))} />
        <StatCard label="Total net payout" value={<NetPayoutCell value={sumMoney(lines.map((l) => l.net_payout))} />} />
      </div>

      {lines.length === 0 ? (
        <Banner tone="info" title="Nothing to pay">
          No validated, unpaid sales have a sale date in this range for this selection. Validate the sales, then
          refresh the report.
        </Banner>
      ) : (
        <PayRunLinesTable
          lines={lines}
          onSelect={(l) => setSelectedLineId(l.id)}
          onBonus={(l) => setBonusLineId(l.id)}
          // Only on a PAID report: the statement reads lines frozen at "Mark as paid", so a draft has none.
          onStatement={!isDraft && canExport ? (l) => setStatementRepId(l.rep.id) : undefined}
          canBonus={isDraft && canApprove}
        />
      )}

      <LineBreakdownDrawer runId={run.id} line={selectedLine} open={selectedLine !== null} onClose={() => setSelectedLineId(null)} />
      <RepStatementDrawer runId={run.id} repId={statementRepId} onClose={() => setStatementRepId(null)} />
      <BonusModal runId={run.id} line={bonusLine} onClose={() => setBonusLineId(null)} />
      <FinalizeConfirmModal runId={run.id} label={run.display_label} open={finalizeOpen} onClose={() => setFinalizeOpen(false)} />
      <ExportModal
        runId={run.id}
        fileSource={fileSource(run, 'payrun-adp')}
        reps={repChoices}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      <PayrollReportModal
        runId={run.id}
        reps={repChoices}
        fixedClient={run.client?.name ?? null}
        open={payrollOpen}
        onClose={() => setPayrollOpen(false)}
      />
      {dialog}
    </div>
  );
}
