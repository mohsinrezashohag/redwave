/**
 * SaleEditRequestsPage — `/sales/edit-requests` (client meeting 2026-11-16). The approvers' queue of rep
 * edit requests: each row shows the change as before → after (server-built diff, products by name).
 * Approve applies it through the same edit path (the server re-checks the 5-day window and status);
 * Reject keeps the sale as it is, with an optional note for the rep. `sales:edit` gates the page; the
 * server is the real gate (§5) and scopes the list to the caller's sales.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import {
  Badge,
  ConfirmDialog,
  FormField,
  PageHeader,
  SegmentedControl,
  Textarea,
  useToast,
} from '../../../components/ui';
import type { BadgeTone } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { RowActions } from '../../../components/data/RowActions';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate, displayDateTime } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useDecideEditRequest, useSaleEditRequestsTable, type EditRequestSortKey } from '../api/useSaleEdits';
import type { SaleEditRequest, SaleEditRequestStatus } from '../sales.types';
import styles from './SaleEditRequestsPage.module.css';

type View = 'pending' | 'approved' | 'rejected' | 'all';

const STATUS_TONE: Record<SaleEditRequestStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'muted',
};
const STATUS_LABEL: Record<SaleEditRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function SaleEditRequestsPage() {
  const canEdit = useCan('sales:edit');
  const [params, setParams] = useSearchParams();
  const view = (params.get('status') as View | null) ?? 'pending';
  const table = useSaleEditRequestsTable(view === 'all' ? undefined : view, canEdit);
  const decide = useDecideEditRequest();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const [approving, setApproving] = useState<SaleEditRequest | null>(null);
  const [rejecting, setRejecting] = useState<SaleEditRequest | null>(null);
  const [note, setNote] = useState('');

  if (!canEdit) {
    return <AccessDenied message="Reviewing sale edit requests requires the sales edit permission." />;
  }

  const run = (req: SaleEditRequest, decision: 'approve' | 'reject') =>
    decide.mutate(
      { id: req.id, decision, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast({
            title: decision === 'approve' ? 'Edit applied' : 'Edit rejected',
            description: `Sale ${req.sale_code}. The rep has been told.`,
            tone: 'success',
          });
          setApproving(null);
          setRejecting(null);
          setNote('');
        },
        onError,
      },
    );

  const columns: DataColumn<SaleEditRequest, EditRequestSortKey>[] = [
    {
      id: 'sale',
      header: 'Sale ID',
      render: (r) => (
        <Link to={`/sales/${r.sale_id}`} className={styles.link}>
          <span className="mono">{r.sale_code}</span>
        </Link>
      ),
    },
    { id: 'customer', header: 'Customer', render: (r) => r.customer_name || '—' },
    { id: 'requested_by', header: 'Requested by', render: (r) => r.requested_by_name ?? r.rep_name ?? '—' },
    {
      id: 'created_at',
      header: 'Requested',
      sortKey: 'created_at',
      numeric: true,
      render: (r) => displayDateTime(r.created_at),
    },
    { id: 'changes', header: 'Changes', render: (r) => <ChangeList request={r} /> },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (r) => (
        <div className={styles.statusCell}>
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {r.status === 'pending' && !r.sale_editable && <span className={styles.muted}>Window closed</span>}
          {r.status === 'pending' && r.sale_editable && (
            <span className={styles.muted}>Until {displayDate(r.edit_window_ends_on)}</span>
          )}
          {r.note && <span className={styles.muted}>Note: {r.note}</span>}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Sale edit requests"
        subtitle="Reps can ask to change their own sale for 5 days after entry. Approving applies the change."
      />
      <SegmentedControl<View>
        value={view}
        onChange={(v) => setParams(v === 'pending' ? {} : { status: v }, { replace: true })}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'all', label: 'All' },
        ]}
      />
      <DataTable<SaleEditRequest, EditRequestSortKey>
        columns={columns}
        rows={table.rows}
        getRowId={(r) => r.id}
        sort={table.sort}
        onSortChange={table.toggleSort}
        page={table.page}
        pageCount={table.pageCount}
        total={table.total}
        limit={table.limit}
        onPageChange={table.setPage}
        rowActions={(r) =>
          r.status === 'pending' ? (
            <RowActions
              label="Decide"
              items={[
                {
                  label: r.sale_editable ? 'Approve' : 'Approve (window closed)',
                  icon: <Check size={15} />,
                  disabled: !r.sale_editable,
                  onSelect: () => setApproving(r),
                },
                { label: 'Reject', icon: <X size={15} />, danger: true, onSelect: () => setRejecting(r) },
              ]}
            />
          ) : null
        }
        isLoading={table.isLoading}
        isError={table.isError}
        error={table.error}
        onRetry={() => void table.refetch()}
        emptyNode={<p className={styles.muted}>No {view === 'all' ? '' : `${view} `}edit requests.</p>}
        forbiddenMessage="You do not have permission to review sale edit requests."
        aria-label="Sale edit requests"
      />

      <ConfirmDialog
        open={!!approving}
        onOpenChange={(o) => !o && setApproving(null)}
        title={`Apply this edit to sale ${approving?.sale_code ?? ''}?`}
        description="The sale changes now and the rep is told."
        confirmLabel="Approve and apply"
        loading={decide.isPending}
        onConfirm={() => approving && run(approving, 'approve')}
      >
        {approving && <ChangeList request={approving} />}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => {
          if (!o) {
            setRejecting(null);
            setNote('');
          }
        }}
        title={`Reject the edit to sale ${rejecting?.sale_code ?? ''}?`}
        description="The sale stays as it is. The rep is told, with your note if you add one."
        confirmLabel="Reject edit"
        destructive
        loading={decide.isPending}
        onConfirm={() => rejecting && run(rejecting, 'reject')}
      >
        <FormField label="Note for the rep" help="Optional.">
          <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

/** The server-built diff: one line per changed field, before → after. */
function ChangeList({ request }: { request: SaleEditRequest }) {
  if (request.diff.length === 0) return <span className={styles.muted}>—</span>;
  return (
    <ul className={styles.diff}>
      {request.diff.map((d) => (
        <li key={d.field} className={styles.diffRow}>
          <span className={styles.diffLabel}>{d.label}</span>
          <span className={styles.before}>{d.before ?? '—'}</span>
          <span aria-hidden="true" className={styles.arrow}>
            →
          </span>
          <span className={styles.after}>{d.after ?? '—'}</span>
        </li>
      ))}
    </ul>
  );
}
