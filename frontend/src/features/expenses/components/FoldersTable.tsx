/**
 * FoldersTable — the report-folder list (report-as-folder, EXP-001). Each row is a folder with its DERIVED
 * status, reimbursable total, item count, and aggregated Alert/Warning count. Row → the folder workspace; a
 * kebab offers contextual quick-actions (Submit for an owner with drafts; Approve-all/Return-all for an
 * approver) so an admin can act on a folder WITHOUT opening it (req #2). The UI computes nothing; the server
 * is the real gate (§5). Tokens only.
 */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, useToast, type MenuEntry } from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useReps } from '../api/useLookups';
import { useExpenseReportsTable, type ReportFilters } from '../api/useExpenseReports';
import { useReviewReport, useSubmitReport } from '../api/useExpenseMutations';
import { FolderStatusBadge } from './FolderStatusBadge';
import styles from './expenses.module.css';
import type { ExpenseReport } from '../expenses.types';

type SortKey = 'name' | 'week_start' | 'created_at';

export function FoldersTable({ filters, canReview }: { filters: ReportFilters; canReview: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { user } = useAuth();
  const canViewReps = useCan('hrm:view');

  const list = useExpenseReportsTable(filters);
  const reps = useReps(canViewReps);
  const submit = useSubmitReport();
  const review = useReviewReport();

  const repName = (id: string | null) => (id ? reps.data?.find((r) => r.id === id)?.full_name ?? '—' : '—');

  const act = (fn: Promise<unknown>, ok: string) => fn.then(() => toast({ title: ok, tone: 'success' })).catch(onError);

  const rowMenu = (f: ExpenseReport): MenuEntry[] => {
    const entries: MenuEntry[] = [{ label: 'Open', onSelect: () => navigate(`/expenses/reports/${f.id}`) }];
    const isOwner = f.submitted_by === user?.id;
    if (isOwner && (f.status === 'draft' || f.status === 'needs_attention')) {
      entries.push({ label: 'Submit', onSelect: () => act(submit.mutateAsync(f.id), 'Folder submitted') });
    }
    if (canReview && f.status === 'pending') {
      entries.push(
        'separator',
        { label: 'Approve all', onSelect: () => act(review.mutateAsync({ id: f.id, body: { decision: 'approve' } }), 'Folder approved') },
        { label: 'Send all back', onSelect: () => act(review.mutateAsync({ id: f.id, body: { decision: 'send_back' } }), 'Folder returned') },
      );
    }
    return entries;
  };

  // Do the loaded rows belong to more than one stakeholder? A folder's owner is its rep, or its submitter
  // when there is no rep (an admin expensing their own).
  const multiStakeholder = useMemo(
    () => new Set((list.rows ?? []).map((f) => f.rep_id ?? `user:${f.submitted_by}`)).size > 1,
    [list.rows],
  );

  const columns: DataColumn<ExpenseReport, SortKey>[] = useMemo(() => {
    const cols: DataColumn<ExpenseReport, SortKey>[] = [
      {
        id: 'name',
        header: 'Report',
        sortKey: 'name',
        render: (f) => (
          <span className={styles.folderCell}>
            <Link to={`/expenses/reports/${f.id}`}>{f.name}</Link>
            <span className={`mono ${styles.folderPeriod}`}>
              {displayDate(f.week_start)} – {displayDate(f.week_end)}
            </span>
          </span>
        ),
      },
    ];
    // A week is now ONE folder per stakeholder, so two rows for the same week can only mean two DIFFERENT
    // people — exactly when the list must say whose. Shown whenever the viewer can resolve rep names, and
    // forced on as soon as the loaded rows actually span more than one owner, so same-week rows are never
    // indistinguishable.
    if (canViewReps || multiStakeholder) cols.push({ id: 'rep', header: 'Rep', render: (f) => repName(f.rep_id) });
    cols.push(
      { id: 'items', header: 'Items', numeric: true, render: (f) => String(f.item_count) },
      { id: 'total', header: 'Reimbursable', align: 'right', numeric: true, render: (f) => money(f.total_reimbursable_cad) },
      { id: 'status', header: 'Status', render: (f) => <FolderStatusBadge status={f.status} /> },
      {
        id: 'flags',
        header: 'Flags',
        render: (f) =>
          f.validation.alert_count > 0 ? (
            <Badge tone="danger">{f.validation.alert_count} alert{f.validation.alert_count > 1 ? 's' : ''}</Badge>
          ) : f.validation.warning_count > 0 ? (
            <Badge tone="warning">{f.validation.warning_count} warning{f.validation.warning_count > 1 ? 's' : ''}</Badge>
          ) : (
            <span className={styles.muted}>—</span>
          ),
      },
      { id: 'created', header: 'Created', sortKey: 'created_at', render: (f) => <span className="mono">{displayDate(f.created_at)}</span> },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reps.data, canViewReps, multiStakeholder]);

  if (isForbidden(list.error)) {
    return <AccessDenied message="You don’t have permission to view expenses." />;
  }

  return (
    <DataTable<ExpenseReport, SortKey>
      columns={columns}
      rows={list.rows}
      getRowId={(f) => f.id}
      sort={{ key: list.sort.key, dir: list.sort.dir }}
      onSortChange={list.toggleSort}
      page={list.page}
      pageCount={list.pageCount}
      total={list.total}
      limit={list.limit}
      onPageChange={list.setPage}
      rowActions={(f) => <RowActions label="Folder actions" items={rowMenu(f)} />}
      isLoading={list.isLoading}
      isError={list.isError}
      error={list.error}
      onRetry={() => void list.refetch()}
      emptyNode={<p className="mono">No expense reports yet — create one to start adding items.</p>}
      forbiddenMessage="You don’t have permission to view expenses."
      aria-label="Expense report folders"
    />
  );
}
