/**
 * ExpenseItemsTable — the item-first expense list on the shared <DataTable> (server pagination/sort + the
 * FORBIDDEN state). Columns: date · category · rep (gated) · client (gated) · description · KM marker ·
 * status · amount. Approvers get row selection → a bulk approve/reject/send-back bar; per-row View/Edit/
 * Delete via a kebab (edit-gating EXP-007; delete only pre-approval). Convenience gating only — the server
 * is the real gate (§5). Tokens only.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Badge, ConfirmDialog, DropdownMenu, IconButton, useToast, type MenuEntry } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { useExpenseItemsTable, useFieldConfigs } from '../api/useExpenseItems';
import { useDeleteItem } from '../api/useExpenseMutations';
import { useClients, useReps } from '../api/useLookups';
import { categoryLabel } from '../format';
import { ExpenseStatusBadge } from './ExpenseStatusBadge';
import { BulkReviewBar } from './BulkReviewBar';
import type { ExpenseItem, ExpenseFilters, ExpenseSortKey } from '../expenses.types';
import styles from './expenses.module.css';

const REVIEWABLE = new Set(['submitted', 'sent_back']);

export function ExpenseItemsTable({ filters, canReview }: { filters: ExpenseFilters; canReview: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { isSuperAdmin } = useAuth();
  const canEdit = useCan('expenses:edit');
  const canDelete = useCan('expenses:delete');
  const canViewReps = useCan('hrm:view');
  const canViewClients = useCan('clients:view');

  const list = useExpenseItemsTable(filters);
  const configs = useFieldConfigs();
  const reps = useReps(canViewReps);
  const clients = useClients(canViewClients);
  const del = useDeleteItem();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<ExpenseItem | null>(null);

  const repName = (id: string | null) => (id ? reps.data?.find((r) => r.id === id)?.full_name ?? id.slice(0, 8) : '—');
  const clientName = (id: string | null) => (id ? clients.data?.find((c) => c.id === id)?.name ?? '—' : '—');

  const isItemEditable = (it: ExpenseItem) => (it.status === 'approved' ? isSuperAdmin : canEdit);
  const isItemDeletable = (it: ExpenseItem) => canDelete && it.status !== 'approved';

  const rowMenu = (it: ExpenseItem): MenuEntry[] => {
    const entries: MenuEntry[] = [{ label: 'View', icon: <Eye size={15} />, onSelect: () => navigate(`/expenses/${it.id}`) }];
    if (isItemEditable(it)) entries.push({ label: 'Edit', icon: <Pencil size={15} />, onSelect: () => navigate(`/expenses/${it.id}/edit`) });
    if (isItemDeletable(it)) entries.push('separator', { label: 'Delete', icon: <Trash2 size={15} />, onSelect: () => setToDelete(it) });
    return entries;
  };

  const columns: DataColumn<ExpenseItem, ExpenseSortKey>[] = useMemo(() => {
    const cols: DataColumn<ExpenseItem, ExpenseSortKey>[] = [
      { id: 'expense_date', header: 'Date', sortKey: 'expense_date', render: (it) => <span className="mono">{displayDate(it.expense_date)}</span> },
      {
        id: 'category',
        header: 'Category',
        sortKey: 'category',
        render: (it) => (
          <span className={styles.categoryCell}>
            {categoryLabel(it.category, configs.data)}
            {it.km_log && <Badge tone="info">KM</Badge>}
          </span>
        ),
      },
    ];
    if (canViewReps) cols.push({ id: 'rep', header: 'Rep', render: (it) => repName(it.rep_id) });
    if (canViewClients) cols.push({ id: 'client', header: 'Client', render: (it) => clientName(it.client_id) });
    cols.push(
      { id: 'description', header: 'Description', render: (it) => it.description },
      { id: 'status', header: 'Status', sortKey: 'status', render: (it) => <ExpenseStatusBadge status={it.status} /> },
      { id: 'amount', header: 'Amount', sortKey: 'amount', numeric: true, render: (it) => money(it.amount) },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs.data, reps.data, clients.data, canViewReps, canViewClients]);

  const toggle = (id: string, next: boolean) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  const selectableRows = list.rows.filter((r) => REVIEWABLE.has(r.status));
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((prev) => {
      if (allSelected) return new Set();
      const s = new Set(prev);
      selectableRows.forEach((r) => s.add(r.id));
      return s;
    });

  const confirmDelete = () => {
    if (!toDelete) return;
    del.mutate(toDelete.id, {
      onSuccess: () => {
        toast({ title: 'Expense deleted', tone: 'success' });
        setToDelete(null);
      },
      onError,
    });
  };

  return (
    <>
      <DataTable<ExpenseItem, ExpenseSortKey>
        columns={columns}
        rows={list.rows}
        getRowId={(it) => it.id}
        sort={{ key: list.sort.key, dir: list.sort.dir }}
        onSortChange={list.toggleSort}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        limit={list.limit}
        onPageChange={list.setPage}
        selectedIds={canReview ? selected : undefined}
        onSelect={canReview ? toggle : undefined}
        isRowSelectable={(it) => REVIEWABLE.has(it.status)}
        onToggleAll={canReview ? toggleAll : undefined}
        allSelectableSelected={allSelected}
        bulkActions={canReview ? <BulkReviewBar ids={[...selected]} onDone={() => setSelected(new Set())} /> : undefined}
        rowActions={(it) => (
          <DropdownMenu trigger={<IconButton label="Row actions" icon={<MoreHorizontal size={16} />} size="sm" />} items={rowMenu(it)} />
        )}
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyNode={<p className="mono">No expense items match these filters.</p>}
        forbiddenMessage="You don’t have permission to view expenses."
        aria-label="Expense items"
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete expense item"
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={confirmDelete}
      >
        This permanently removes the expense item. Approved items can’t be deleted.
      </ConfirmDialog>
    </>
  );
}
