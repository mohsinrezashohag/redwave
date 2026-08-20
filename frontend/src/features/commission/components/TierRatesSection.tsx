/**
 * TierRatesSection — PER-PRODUCT tier rates in the shared EffectiveDatedTable, beside the tier schedule
 * they refine. "Add rate" supersedes within its own (client, product, tier) scope; PENDING rows offer Edit
 * and Delete. The server is the real gate (current/past → 422, back-date → 422).
 *
 * The empty state matters here more than usual: no rows is the CORRECT default, not a gap. Every product
 * is paid the tier schedule's own rate until an override exists, so the copy says that rather than
 * implying something is missing. — #10, per-product rep rates
 */
import { useState } from 'react';
import { Button, Card, ConfirmDialog, EffectiveDatedTable, useToast, type EffectiveColumn } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { useClients, useTierRates } from '../api/useCommission';
import { useDeleteTierRate } from '../api/useCommissionMutations';
import { TierRateModal } from './TierRateModal';
import { PendingRowActions } from './PendingRowActions';
import { SCOPE_ALL, scopeDefaultClientId, scopeLabel, scopeParam, type ScopeValue } from '../clientScope';
import type { TierRate } from '../commission.types';
import styles from './commission.module.css';

export function TierRatesSection({ scope = SCOPE_ALL }: { scope?: ScopeValue }) {
  const canEdit = useCan('commission:edit');
  const canViewClients = useCan('clients:view');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const remove = useDeleteTierRate();
  const [open, setOpen] = useState(false);
  const [editRate, setEditRate] = useState<TierRate | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const q = useTierRates('all', scopeParam(scope));
  const clients = useClients(canViewClients);

  const columns: EffectiveColumn<TierRate>[] = [
    ...(scope === SCOPE_ALL
      ? [{ header: 'Applies to', render: (r: TierRate) => scopeLabel(r.client_id, clients.data) }]
      : []),
    { header: 'Product', render: (r) => r.product?.name ?? r.product_id },
    { header: 'Tier', render: (r) => `Tier ${r.tier_number}` },
    { header: 'Rate', align: 'right', render: (r) => money(r.amount) },
  ];
  const rows = q.data ?? [];

  const onConfirmDelete = () => {
    if (!deleteId) return;
    remove.mutate(deleteId, {
      onSuccess: () => { toast({ title: 'Product rate deleted', tone: 'success' }); setDeleteId(null); },
      onError: (e) => { onError(e); setDeleteId(null); },
    });
  };

  return (
    <Card
      title="Per-product rates"
      actions={canEdit ? <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Add rate</Button> : undefined}
    >
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={
          <p className={styles.note}>
            No per-product rates — every product is paid the tier schedule&rsquo;s own rate. Add one only
            where a product should pay differently.
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
        <TierRateModal open defaultClientId={scopeDefaultClientId(scope)} onClose={() => setOpen(false)} />
      )}
      {editRate && <TierRateModal open rate={editRate} onClose={() => setEditRate(null)} />}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete pending product rate?"
        description="Removes the future-dated rate before it takes effect. The product returns to the tier schedule rate."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={onConfirmDelete}
      />
    </Card>
  );
}
