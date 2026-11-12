/**
 * SalesTable — the validation-queue surface, built on the shared <DataTable> (server pagination/sort +
 * the FORBIDDEN state). Bulk-select (Entered/Validated rows) → bulk Validate (sales:approve) or bulk
 * soft-delete (sales:delete, typed-confirm). Per-row actions via SaleRowActions. Money/IDs use mono;
 * status uses StatusPill. Convenience gating only — the server is the real gate (§5). Tokens only.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ConfirmDialog, PersonName, StatusPill, useToast } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { useClients } from '../api/useSales';
import { useBulkDeleteSales, useBulkValidate } from '../api/useSaleMutations';
import { useSalesList, type SortKey } from '../api/useSalesList';
import type { BulkValidateResult, Sale, SalesFilters } from '../sales.types';
import { ProductSummary } from './ProductSummary';
import { GreenfieldBadge } from './GreenfieldBadge';
import { SaleRowActions } from './SaleRowActions';
import { BulkValidateSummary } from './BulkValidateSummary';
import styles from './SalesTable.module.css';

const isSelectable = (s: Sale) => s.status === 'entered' || s.status === 'validated';

export function SalesTable({ filters }: { filters: SalesFilters }) {
  const list = useSalesList(filters);
  const canViewClients = useCan('clients:view');
  const canApprove = useCan('sales:approve');
  const canDelete = useCan('sales:delete');
  const canBulk = canApprove || canDelete;
  const clients = useClients(canViewClients);
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const bulk = useBulkValidate();
  const bulkDelete = useBulkDeleteSales();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<BulkValidateResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? '—';

  const selectableOnPage = useMemo(() => list.rows.filter(isSelectable), [list.rows]);
  const allSelectableSelected = selectableOnPage.length > 0 && selectableOnPage.every((s) => selected.has(s.id));

  const setOne = (id: string, next: boolean) =>
    setSelected((prev) => {
      const set = new Set(prev);
      if (next) set.add(id);
      else set.delete(id);
      return set;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const set = new Set(prev);
      if (allSelectableSelected) selectableOnPage.forEach((s) => set.delete(s.id));
      else selectableOnPage.forEach((s) => set.add(s.id));
      return set;
    });
  const clear = () => setSelected(new Set());

  const runBulkValidate = () =>
    bulk.mutate(
      { sale_ids: [...selected] },
      {
        onSuccess: (result) => {
          toast({
            title: `Validated ${result.validated} sale(s)`,
            description: result.failed > 0 ? `${result.failed} skipped` : undefined,
            tone: result.failed > 0 ? 'warning' : 'success',
          });
          setSummary(result.failed > 0 ? result : null);
          clear();
        },
        onError,
      },
    );

  const runBulkDelete = () =>
    bulkDelete.mutate([...selected], {
      onSuccess: ({ deleted, failed }) => {
        toast({
          title: `Deleted ${deleted} sale(s)`,
          description: failed > 0 ? `${failed} could not be deleted` : undefined,
          tone: failed > 0 ? 'warning' : 'success',
        });
        setConfirmDelete(false);
        clear();
      },
      onError,
    });

  const columns: DataColumn<Sale, SortKey>[] = [
    {
      id: 'sale_code',
      header: 'Sale ID',
      numeric: true,
      sortKey: 'sale_code',
      render: (s) => (
        <Link to={`/sales/${s.id}`} className={styles.idLink}>
          {s.sale_code}
        </Link>
      ),
    },
    { id: 'customer', header: 'Customer', sortKey: 'customer_name', render: (s) => s.customer_name },
    // Who sold it — for managers/admins, who see more than their own sales. 2026-11-12
    ...(canApprove
      ? [{ id: 'rep', header: 'Rep', render: (s: Sale) => (s.rep_name ? <PersonName name={s.rep_name} photoUrl={s.rep_photo_url} /> : '—') }]
      : []),
    ...(canViewClients ? [{ id: 'client', header: 'Client', render: (s: Sale) => clientName(s.client_id) }] : []),
    { id: 'products', header: 'Products', render: (s) => <ProductSummary items={s.sale_items} /> },
    { id: 'sale_date', header: 'Sale date', numeric: true, sortKey: 'sale_date', render: (s) => displayDate(s.sale_date) },
    { id: 'greenfield', header: 'Greenfield', render: (s) => <GreenfieldBadge on={s.is_greenfield} /> },
    { id: 'status', header: 'Status', sortKey: 'status', render: (s) => <StatusPill status={s.status} /> },
  ];

  return (
    <div className={styles.wrap}>
      {summary && <BulkValidateSummary result={summary} />}

      <DataTable<Sale, SortKey>
        columns={columns}
        rows={list.rows}
        getRowId={(s) => s.id}
        sort={{ key: list.sort.key, dir: list.sort.dir }}
        onSortChange={list.toggleSort}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        limit={list.limit}
        onPageChange={list.setPage}
        selectedIds={canBulk ? selected : undefined}
        onSelect={canBulk ? setOne : undefined}
        isRowSelectable={isSelectable}
        onToggleAll={canBulk ? toggleAll : undefined}
        allSelectableSelected={allSelectableSelected}
        rowActions={(s) => <SaleRowActions sale={s} />}
        bulkActions={
          <>
            {canApprove && (
              <Button variant="primary" size="sm" loading={bulk.isPending} onClick={runBulkValidate}>
                Validate selected
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete selected
              </Button>
            )}
            <Button variant="tertiary" size="sm" onClick={clear}>
              Clear
            </Button>
          </>
        }
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyNode={<EmptyState />}
        forbiddenMessage="You don’t have permission to view sales."
        aria-label="Sales"
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selected.size} sale(s)?`}
        description="Selected sales are soft-deleted (the records are preserved) and removed from active lists. Paid sales cannot be deleted and will be skipped."
        confirmLabel="Delete sales"
        requireTyped="DELETE"
        loading={bulkDelete.isPending}
        onConfirm={runBulkDelete}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyMsg}>No sales match these filters.</p>
    </div>
  );
}
