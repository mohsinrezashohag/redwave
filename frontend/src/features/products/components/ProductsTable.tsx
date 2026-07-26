/**
 * ProductsTable — the cross-client products list on the shared <DataTable> (server pagination/sort + the
 * FORBIDDEN state). Row actions: edit (name; product_type is immutable) + soft-deactivate/reactivate; View
 * → the owning client's detail. Bulk soft-deactivate (clients:edit) via a typed ConfirmDialog. Reuses the
 * clients-domain ProductFormModal + mutations. Convenience gating only — the server is the real gate (§5).
 */
import { ExternalLink, Pencil, Power, PowerOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  ConfirmDialog,
  useToast,
  type MenuEntry,
} from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { productTypeLabel } from '../../../lib/format/productType';
import { useBulkDeactivateProducts, useUpdateProduct } from '../../clients/api/useClientMutations';
import { ProductFormModal, type ProductFormState } from '../../clients/components/ProductFormModal';
import { useClients } from '../../clients/api/useClients';
import { useProductsTable } from '../api/useProducts';
import type { Product, ProductSortKey, ProductsFilters } from '../products.types';

export function ProductsTable({ filters }: { filters: ProductsFilters }) {
  const list = useProductsTable(filters);
  const navigate = useNavigate();
  const canEdit = useCan('clients:edit');
  const canViewClients = useCan('clients:view');
  const clients = useClients('all', canViewClients);
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateProduct();
  const bulkDeactivate = useBulkDeactivateProducts();

  const [modal, setModal] = useState<ProductFormState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? id;

  const activeOnPage = useMemo(() => list.rows.filter((p) => p.is_active), [list.rows]);
  const allActiveSelected = activeOnPage.length > 0 && activeOnPage.every((p) => selected.has(p.id));

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
      if (allActiveSelected) activeOnPage.forEach((p) => set.delete(p.id));
      else activeOnPage.forEach((p) => set.add(p.id));
      return set;
    });
  const clear = () => setSelected(new Set());

  const setActive = (p: Product, is_active: boolean) =>
    update.mutate(
      { id: p.id, body: { is_active } },
      { onSuccess: () => toast({ title: is_active ? 'Product reactivated' : 'Product deactivated', tone: 'success' }), onError },
    );

  const runBulkDeactivate = () =>
    bulkDeactivate.mutate([...selected], {
      onSuccess: ({ done, failed }) => {
        toast({
          title: `Deactivated ${done} product(s)`,
          description: failed > 0 ? `${failed} could not be deactivated` : undefined,
          tone: failed > 0 ? 'warning' : 'success',
        });
        setConfirmBulk(false);
        clear();
      },
      onError,
    });

  const rowMenu = (p: Product): MenuEntry[] => [
    { label: 'Edit', icon: <Pencil size={15} />, onSelect: () => setModal({ mode: 'edit', product: p }) },
    { label: 'View client', icon: <ExternalLink size={15} />, onSelect: () => navigate(`/admin/clients/${p.client_id}`) },
    'separator',
    p.is_active
      ? { label: 'Deactivate', icon: <PowerOff size={15} />, danger: true, onSelect: () => setActive(p, false) }
      : { label: 'Reactivate', icon: <Power size={15} />, onSelect: () => setActive(p, true) },
  ];

  const columns: DataColumn<Product, ProductSortKey>[] = [
    { id: 'name', header: 'Name', sortKey: 'name', render: (p) => p.name },
    { id: 'type', header: 'Type', sortKey: 'product_type', render: (p) => <Badge tone="neutral">{productTypeLabel(p.product_type)}</Badge> },
    ...(canViewClients ? [{ id: 'client', header: 'Client', render: (p: Product) => clientName(p.client_id) }] : []),
    { id: 'status', header: 'Status', sortKey: 'is_active', render: (p) => <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Active' : 'Inactive'}</Badge> },
  ];

  return (
    <>
      <DataTable<Product, ProductSortKey>
        columns={columns}
        rows={list.rows}
        getRowId={(p) => p.id}
        sort={{ key: list.sort.key, dir: list.sort.dir }}
        onSortChange={list.toggleSort}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        limit={list.limit}
        onPageChange={list.setPage}
        selectedIds={canEdit ? selected : undefined}
        onSelect={canEdit ? setOne : undefined}
        isRowSelectable={(p) => p.is_active}
        onToggleAll={canEdit ? toggleAll : undefined}
        allSelectableSelected={allActiveSelected}
        rowActions={(p) => (
          <RowActions label="Product actions" items={rowMenu(p)} />
        )}
        bulkActions={
          <>
            <Button variant="destructive" size="sm" onClick={() => setConfirmBulk(true)}>
              Deactivate selected
            </Button>
            <Button variant="tertiary" size="sm" onClick={clear}>
              Clear
            </Button>
          </>
        }
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyNode={<p className="mono">No products match these filters.</p>}
        forbiddenMessage="You don’t have permission to view products."
        aria-label="Products"
      />

      <ProductFormModal state={modal} onClose={() => setModal(null)} />

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Deactivate ${selected.size} product(s)?`}
        description="Selected products are marked inactive (soft — history is preserved). You can reactivate them later."
        confirmLabel="Deactivate products"
        requireTyped="DEACTIVATE"
        loading={bulkDeactivate.isPending}
        onConfirm={runBulkDeactivate}
      />
    </>
  );
}
