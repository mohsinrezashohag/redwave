/**
 * ClientsTable — the clients management list on the shared <DataTable> (server pagination/sort + the
 * FORBIDDEN state). Row actions: edit, soft-deactivate/reactivate (an is_active PATCH that PRESERVES
 * history, behind a confirm). Bulk soft-deactivate (clients:edit) via a typed ConfirmDialog. Row → client
 * detail. Convenience gating only — the server is the real gate (§5). Tokens only.
 */
import { Pencil, Power, PowerOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  ConfirmDialog,
  Modal,
  useToast,
  type MenuEntry,
} from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { useBulkDeactivateClients, useUpdateClient } from '../api/useClientMutations';
import { useClientsTable, type ClientSortKey } from '../api/useClients';
import { ClientStatusBadge } from './ClientStatusBadge';
import type { Client, ClientsFilters } from '../clients.types';
import styles from './clients.module.css';

export function ClientsTable({ filters, onEdit }: { filters: ClientsFilters; onEdit: (c: Client) => void }) {
  const list = useClientsTable(filters);
  const canEdit = useCan('clients:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateClient();
  const bulkDeactivate = useBulkDeactivateClients();

  const [confirm, setConfirm] = useState<Client | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  const activeOnPage = useMemo(() => list.rows.filter((c) => c.is_active), [list.rows]);
  const allActiveSelected = activeOnPage.length > 0 && activeOnPage.every((c) => selected.has(c.id));

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
      if (allActiveSelected) activeOnPage.forEach((c) => set.delete(c.id));
      else activeOnPage.forEach((c) => set.add(c.id));
      return set;
    });
  const clear = () => setSelected(new Set());

  const setActive = (c: Client, is_active: boolean) =>
    update.mutate(
      { id: c.id, body: { is_active } },
      {
        onSuccess: () => {
          toast({ title: is_active ? 'Client reactivated' : 'Client deactivated', tone: 'success' });
          setConfirm(null);
        },
        onError,
      },
    );

  const runBulkDeactivate = () =>
    bulkDeactivate.mutate([...selected], {
      onSuccess: ({ done, failed }) => {
        toast({
          title: `Deactivated ${done} client(s)`,
          description: failed > 0 ? `${failed} could not be deactivated` : undefined,
          tone: failed > 0 ? 'warning' : 'success',
        });
        setConfirmBulk(false);
        clear();
      },
      onError,
    });

  const rowMenu = (c: Client): MenuEntry[] => [
    { label: 'Edit', icon: <Pencil size={15} />, onSelect: () => onEdit(c) },
    'separator',
    c.is_active
      ? { label: 'Deactivate', icon: <PowerOff size={15} />, danger: true, onSelect: () => setConfirm(c) }
      : { label: 'Reactivate', icon: <Power size={15} />, onSelect: () => setActive(c, true) },
  ];

  const columns: DataColumn<Client, ClientSortKey>[] = [
    { id: 'code', header: 'Code', sortKey: 'client_code', render: (c) => <span className={styles.codeCell}>{c.client_code}</span> },
    {
      id: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (c) => (
        <Link to={`/admin/clients/${c.id}`} className={styles.nameLink}>
          {c.name}
        </Link>
      ),
    },
    { id: 'market', header: 'Market', sortKey: 'market', render: (c) => <Badge tone="neutral">{c.market}</Badge> },
    { id: 'mpu', header: 'MPU IDs', render: (c) => (c.supplies_mpu_id ? 'Yes' : 'No') },
    { id: 'status', header: 'Status', sortKey: 'is_active', render: (c) => <ClientStatusBadge active={c.is_active} /> },
  ];

  return (
    <>
      <DataTable<Client, ClientSortKey>
        columns={columns}
        rows={list.rows}
        getRowId={(c) => c.id}
        sort={{ key: list.sort.key, dir: list.sort.dir }}
        onSortChange={list.toggleSort}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        limit={list.limit}
        onPageChange={list.setPage}
        selectedIds={canEdit ? selected : undefined}
        onSelect={canEdit ? setOne : undefined}
        isRowSelectable={(c) => c.is_active}
        onToggleAll={canEdit ? toggleAll : undefined}
        allSelectableSelected={allActiveSelected}
        rowActions={(c) => (
          <RowActions label="Client actions" items={rowMenu(c)} />
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
        emptyNode={<p className="mono">No clients match this filter.</p>}
        forbiddenMessage="You don’t have permission to view clients."
        aria-label="Clients"
      />

      <Modal
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Deactivate this client?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={update.isPending} onClick={() => confirm && setActive(confirm, false)}>
              Deactivate
            </Button>
          </>
        }
      >
        <strong>{confirm?.name}</strong> will be marked inactive. Its history (products, billing rates, sales)
        is <strong>preserved</strong> — you can reactivate it later.
      </Modal>

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Deactivate ${selected.size} client(s)?`}
        description="Selected clients are marked inactive (soft — history is preserved). You can reactivate them later."
        confirmLabel="Deactivate clients"
        requireTyped="DEACTIVATE"
        loading={bulkDeactivate.isPending}
        onConfirm={runBulkDeactivate}
      />
    </>
  );
}
