/**
 * FlatRatesSection — effective-dated flat rates per product_type in the shared EffectiveDatedTable. "Add
 * rate" supersedes; PENDING rows offer Edit (reuses FlatRateModal) and Delete (ConfirmDialog). The server
 * is the real gate (current/past → 422). Reuses the Session-1 component (#10).
 */
import { useState } from 'react';
import { Button, Card, ConfirmDialog, EffectiveDatedTable, useToast, type EffectiveColumn } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { productTypeLabel } from '../../../lib/format/productType';
import { useClients, useFlatRates } from '../api/useCommission';
import { useDeleteFlatRate } from '../api/useCommissionMutations';
import { FlatRateModal } from './FlatRateModal';
import { PendingRowActions } from './PendingRowActions';
import { SCOPE_ALL, scopeDefaultClientId, scopeLabel, scopeParam, type ScopeValue } from '../clientScope';
import type { FlatRate } from '../commission.types';
import styles from './commission.module.css';

export function FlatRatesSection({ scope = SCOPE_ALL }: { scope?: ScopeValue }) {
  const canEdit = useCan('commission:edit');
  const canViewClients = useCan('clients:view');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const remove = useDeleteFlatRate();
  const [open, setOpen] = useState(false);
  const [editRate, setEditRate] = useState<FlatRate | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const q = useFlatRates('all', scopeParam(scope));
  const clients = useClients(canViewClients);

  const columns: EffectiveColumn<FlatRate>[] = [
    ...(scope === SCOPE_ALL
      ? [{ header: 'Applies to', render: (r: FlatRate) => scopeLabel(r.client_id, clients.data) }]
      : []),
    { header: 'Product type', render: (r) => productTypeLabel(r.product_type) },
    { header: 'Amount', align: 'right', render: (r) => money(r.amount) },
  ];
  const rows = q.data ?? [];

  const onConfirmDelete = () => {
    if (!deleteId) return;
    remove.mutate(deleteId, {
      onSuccess: () => { toast({ title: 'Flat rate deleted', tone: 'success' }); setDeleteId(null); },
      onError: (e) => { onError(e); setDeleteId(null); },
    });
  };

  return (
    <Card
      title="Flat rates"
      actions={canEdit ? <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Add rate</Button> : undefined}
    >
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={
          <p className={styles.note}>
            {scopeDefaultClientId(scope)
              ? 'No flat rates of its own — this client is paid at the global flat rates.'
              : 'No flat rates yet.'}
          </p>
        }
      >
        <EffectiveDatedTable
          rows={rows}
          columns={columns}
          rowActions={canEdit ? (r) => <PendingRowActions status={r.status} onEdit={() => setEditRate(r)} onDelete={() => setDeleteId(r.id)} /> : undefined}
        />
      </DataState>
      {canEdit && open && (
        <FlatRateModal open defaultClientId={scopeDefaultClientId(scope)} onClose={() => setOpen(false)} />
      )}
      {editRate && <FlatRateModal open rate={editRate} onClose={() => setEditRate(null)} />}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete pending flat rate?"
        description="Removes the future-dated rate before it takes effect."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={onConfirmDelete}
      />
    </Card>
  );
}
