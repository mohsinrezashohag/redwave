/**
 * ImportDetailPage — /import/:id. Review the staged rows, RECONCILE the outstanding ones, and COMMIT. The UI
 * does NO matching/commit logic: reconcile + commit are backend calls. The reconcile-before-commit GATE is
 * mirrored to DISABLE the Commit button while outstanding rows remain (+ a banner) — the server 422 is the
 * real gate (incl. the holdback reconcile_total check, which the UI never computes). Commit is atomic +
 * idempotent server-side (#8); after it the batch is locked and re-commit isn't offered. `import:view`;
 * edit/approve gate the actions. 403 → AccessDenied.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Lock } from 'lucide-react';
import { Banner, Button, Card, PageHeader, StatCard, TableError, TableSkeleton, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useImportBatch } from '../api/useImports';
import { downloadErrorReport, useReconcile } from '../api/useImportMutations';
import { ImportStatusBadge } from '../components/ImportStatusBadge';
import { StepIndicator, type StepState } from '../components/StepIndicator';
import { ImportRowsTable } from '../components/ImportRowsTable';
import { MappingEditor } from '../components/MappingEditor';
import { MatchSaleModal } from '../components/MatchSaleModal';
import { ReconcileEditModal } from '../components/ReconcileEditModal';
import { CommitConfirmModal } from '../components/CommitConfirmModal';
import { countsOf, outstandingCount } from '../import.logic';
import { kindOf } from '../import.types';
import styles from '../components/import.module.css';
import type { ImportRow } from '../import.types';

export default function ImportDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canView = useCan('import:view');
  const canEdit = useCan('import:edit');
  const canApprove = useCan('import:approve');

  const q = useImportBatch(id, canView);
  const reconcile = useReconcile();
  const [matchRow, setMatchRow] = useState<ImportRow | null>(null);
  const [editRow, setEditRow] = useState<ImportRow | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing imports requires the import view permission." />;
  }
  if (q.isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Import" />
        <TableSkeleton rows={6} columns={5} />
      </div>
    );
  }
  const batch = q.data;
  if (q.isError || !batch) {
    return (
      <div className={styles.page}>
        <PageHeader title="Import" />
        <TableError message="Couldn’t load this import batch." onRetry={() => q.refetch()} />
      </div>
    );
  }

  const kind = kindOf(batch);
  const counts = countsOf(batch);
  const outstanding = outstandingCount(batch);
  const staged = batch.status === 'staged';
  const committed = batch.status === 'committed';

  const steps: { label: string; state: StepState }[] = [
    { label: 'Stage', state: 'done' },
    { label: 'Reconcile', state: committed ? 'done' : 'current' },
    { label: 'Commit', state: committed ? 'done' : 'upcoming' },
  ];

  const onIgnore = (row: ImportRow) =>
    reconcile.mutate(
      { id: batch.id, body: { resolutions: [{ row_id: row.id, action: 'ignore' }] } },
      { onSuccess: () => toast({ title: 'Row ignored', tone: 'success' }), onError },
    );

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.detailHead}>
            {kind?.label ?? `${batch.source_type} · ${batch.import_type}`}
            <ImportStatusBadge status={batch.status} />
          </span>
        }
        subtitle={`Batch ${batch.id.slice(0, 8)} · created ${displayDate(batch.created_at)}`}
        actions={
          <>
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate('/import')}>Imports</Button>
            {staged && canApprove && (
              <Button variant="primary" leftIcon={<Lock size={16} />} disabled={outstanding > 0} onClick={() => setCommitOpen(true)}>
                Commit
              </Button>
            )}
          </>
        }
      />

      <StepIndicator steps={steps} />

      {committed ? (
        <Banner tone="success" title="Committed — locked">
          Applied {batch.matched_rows} matched row(s){batch.committed_at ? ` on ${displayDate(batch.committed_at)}` : ''}. This batch is read-only; re-committing is a no-op.
        </Banner>
      ) : outstanding > 0 ? (
        <Banner tone="warning" title={`${outstanding} row(s) still need reconciliation`}>
          Resolve every unmatched / duplicate / error row (match, edit, or ignore) before committing. The server blocks a commit while any remain.
        </Banner>
      ) : (
        <Banner tone="info" title="Ready to commit">
          All rows are reconciled. Committing applies the matched rows atomically.
        </Banner>
      )}

      {kind?.needsReconcileTotal && (
        <p className={styles.note}>
          Reconcile total: <span className="mono">{money(batch.reconcile_total)}</span> — the server verifies this matches the staged total of matched rows at commit (the UI computes no total).
        </p>
      )}

      <div className={styles.summary}>
        <StatCard label="Total rows" value={String(counts.total)} />
        <StatCard label="Matched" value={String(counts.matched)} />
        <StatCard label="Outstanding" value={String(outstanding)} />
        <StatCard label="Ignored" value={String(counts.ignored)} />
      </div>

      {staged && canEdit && <MappingEditor batch={batch} kind={kind} />}

      {outstanding > 0 && (
        <div>
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<Download size={14} />}
            onClick={() => downloadErrorReport(batch.id).catch(onError)}
          >
            Download error report (CSV)
          </Button>
        </div>
      )}

      <Card title="Rows" flush>
        <ImportRowsTable batch={batch} kind={kind} canEdit={canEdit} onMatch={setMatchRow} onEdit={setEditRow} onIgnore={onIgnore} />
      </Card>

      <MatchSaleModal batchId={batch.id} row={matchRow} clientId={batch.client_id} onClose={() => setMatchRow(null)} />
      <ReconcileEditModal batchId={batch.id} row={editRow} onClose={() => setEditRow(null)} />
      <CommitConfirmModal batchId={batch.id} kind={kind} matchedCount={counts.matched} open={commitOpen} onClose={() => setCommitOpen(false)} />
    </div>
  );
}
