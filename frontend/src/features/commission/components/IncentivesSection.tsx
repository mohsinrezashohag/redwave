/**
 * IncentivesSection — list incentives in BOTH modes (per_activation / one_time, threshold-relative), filter
 * by status, and create/edit/end. Reuses the playbook (Table + DataState + Modal). The scope client name
 * comes from a clients reference read (gated clients:view), not a rate-stream join (#3). Tokens only.
 */
import { MoreHorizontal, Pencil, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  IconButton,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
  type MenuEntry,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { productTypeLabel } from '../../../lib/format/productType';
import { useClients, useIncentives } from '../api/useCommission';
import { useDeleteIncentive, useUpdateIncentive } from '../api/useCommissionMutations';
import { IncentiveModal, type IncentiveFormState } from './IncentiveModal';
import type { Incentive, IncentiveStatus } from '../commission.types';

const ALL = '__all__';
const STATUS_OPTIONS = [
  { value: ALL, label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'ended', label: 'Ended' },
];

/** A readable badge for the incentive mode + its threshold. */
function targetLabel(inc: Incentive) {
  if (inc.target_type === 'one_time') {
    return <Badge tone="accent">One-time at {inc.target_count ?? '?'}</Badge>;
  }
  return (
    <Badge tone="neutral">
      {inc.target_count ? `Per activation > ${inc.target_count}` : 'Per activation'}
    </Badge>
  );
}

export function IncentivesSection() {
  const canEdit = useCan('commission:edit');
  const canViewClients = useCan('clients:view');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const [status, setStatus] = useState<IncentiveStatus | 'all'>('all');
  const [modal, setModal] = useState<IncentiveFormState>(null);
  const [deleteInc, setDeleteInc] = useState<Incentive | null>(null);
  const q = useIncentives(status);
  const clients = useClients(canViewClients);
  const update = useUpdateIncentive();
  const remove = useDeleteIncentive();

  const clientName = (id: string | null) => (id ? clients.data?.find((c) => c.id === id)?.name ?? 'A client' : 'All clients');
  const end = (inc: Incentive) =>
    update.mutate({ id: inc.id, body: { status: 'ended' } }, { onSuccess: () => toast({ title: 'Incentive ended', tone: 'success' }), onError });

  const onConfirmDelete = () => {
    if (!deleteInc) return;
    remove.mutate(deleteInc.id, {
      onSuccess: () => { toast({ title: 'Incentive deleted', tone: 'success' }); setDeleteInc(null); },
      onError: (e) => { onError(e); setDeleteInc(null); },
    });
  };

  const rowMenu = (inc: Incentive): MenuEntry[] => {
    const items: MenuEntry[] = [{ label: 'Edit', icon: <Pencil size={15} />, onSelect: () => setModal({ mode: 'edit', incentive: inc }) }];
    if (inc.status === 'active') {
      items.push('separator', { label: 'End', icon: <Square size={15} />, danger: true, onSelect: () => end(inc) });
    }
    // Delete is only valid for an incentive never applied to a paid item; the server 422s otherwise.
    items.push({ label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => setDeleteInc(inc) });
    return items;
  };

  const rows = q.data ?? [];
  return (
    <Card
      title="Incentives"
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Select options={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v as IncentiveStatus | 'all')} aria-label="Status filter" />
          {canEdit && <Button variant="secondary" size="sm" onClick={() => setModal({ mode: 'create' })}>New incentive</Button>}
        </div>
      }
    >
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No incentives yet.</p>}
      >
        <Table density="comfortable">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Scope</TH>
              <TH>Target</TH>
              <TH>Window</TH>
              <TH align="right">Amount</TH>
              <TH>Status</TH>
              <TH align="right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((inc) => (
              <TR key={inc.id}>
                <TD>{inc.name}</TD>
                <TD>
                  {clientName(inc.scope_client_id)}
                  {inc.scope_product_type ? ` · ${productTypeLabel(inc.scope_product_type)}` : ''}
                </TD>
                <TD>{targetLabel(inc)}</TD>
                <TD>
                  <span className="mono">{displayDate(inc.window_start)}</span> – <span className="mono">{displayDate(inc.window_end)}</span>
                </TD>
                <TD numeric>{money(inc.amount)}</TD>
                <TD>
                  <Badge tone={inc.status === 'active' ? 'success' : 'muted'}>{inc.status === 'active' ? 'Active' : 'Ended'}</Badge>
                </TD>
                <TD align="right">
                  {canEdit ? (
                    <DropdownMenu trigger={<IconButton label="Incentive actions" icon={<MoreHorizontal size={16} />} size="sm" />} items={rowMenu(inc)} />
                  ) : (
                    '—'
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>
      <IncentiveModal state={modal} onClose={() => setModal(null)} />
      <ConfirmDialog
        open={!!deleteInc}
        onOpenChange={(o) => !o && setDeleteInc(null)}
        title="Delete incentive?"
        description="This permanently removes the incentive. If it has already been applied to a paid item, the server will refuse — end it instead."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={onConfirmDelete}
      />
    </Card>
  );
}
