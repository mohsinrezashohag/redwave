/**
 * RepRatesSection (FlatRatesSection) — what a rep is paid per item, effective-dated in the shared
 * EffectiveDatedTable (#10). No tiers and no split since 2026-11-13: every item pays ONE rate. A rate is for
 * a product TYPE (internet, greenfield internet, TV, …) or for one PRODUCT, globally or for one client; the
 * most specific wins (client + product → product → client + type → type). "Add rate" supersedes; PENDING rows
 * offer Edit and Delete. The server is the real gate (current/past → 422).
 */
import { useState } from 'react';
import { Button, Card, ConfirmDialog, EffectiveDatedTable, useToast, type EffectiveColumn } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { productTypeLabel } from '../../../lib/format/productType';
import { useClients, useFlatRates, useProductNames } from '../api/useCommission';
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
  const productNames = useProductNames();

  const columns: EffectiveColumn<FlatRate>[] = [
    ...(scope === SCOPE_ALL
      ? [{ header: 'Applies to', render: (r: FlatRate) => scopeLabel(r.client_id, clients.data) }]
      : []),
    { header: 'Product type', render: (r) => productTypeLabel(r.product_type) },
    {
      header: 'Product',
      render: (r) => (r.product_id ? (productNames.get(r.product_id) ?? 'One product') : <span className={styles.note}>Every product of this type</span>),
    },
    { header: 'Rep rate', align: 'right', render: (r) => money(r.amount) },
  ];
  const rows = q.data ?? [];

  const onConfirmDelete = () => {
    if (!deleteId) return;
    remove.mutate(deleteId, {
      onSuccess: () => { toast({ title: 'Rep rate deleted', tone: 'success' }); setDeleteId(null); },
      onError: (e) => { onError(e); setDeleteId(null); },
    });
  };

  return (
    <Card
      title="Rep rates"
      actions={canEdit ? <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Add rate</Button> : undefined}
    >
      <p className={styles.note}>
        Each sale item pays one rate. The most specific rate wins: a client&rsquo;s rate for a product, then the
        product&rsquo;s rate, then the client&rsquo;s rate for the product type, then the default for the type.
        Greenfield internet always pays the greenfield rate.
      </p>
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={
          <p className={styles.note}>
            {scopeDefaultClientId(scope)
              ? 'No rates of its own. This client is paid at the default rates.'
              : 'No rates yet.'}
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
        title="Delete pending rate?"
        description="Removes the future-dated rate before it takes effect."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={onConfirmDelete}
      />
    </Card>
  );
}
