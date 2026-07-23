/**
 * KmRatesPage — /admin/km-rates. Manage the per-client, effective-dated kilometre rate (EXP-004).
 * REP rows drive the reimbursement paid to reps; CLIENT-BILL rows are stored for the client expense
 * document — the two streams are never combined (#3). Read gated km_rates:view; add/delete gated
 * km_rates:edit (its own RBAC module, so a role can manage km rates without all Expenses access). The
 * server is the real gate (§5); 403 → AccessDenied. Reuses the shared EffectiveDatedTable
 * (append-new-future-row; current/past rows immutable). Tokens only.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EffectiveDatedTable,
  IconButton,
  PageHeader,
  Select,
  useToast,
  type EffectiveColumn,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../expenses/api/useLookups';
import { useKmRates, useDeleteKmRate, type KmRateFilters } from '../api/useKmRates';
import { KmRateModal } from '../components/KmRateModal';
import { OfficeOriginCard } from '../components/OfficeOriginCard';
import type { KmRate } from '../kmRates.types';
import styles from '../components/kmRates.module.css';

const STREAM_LABEL: Record<string, string> = { rep: 'Rep', client_bill: 'Client bill' };

export default function KmRatesPage() {
  const canView = useCan('km_rates:view');
  const canEdit = useCan('km_rates:edit');
  const canViewClients = useCan('clients:view');
  const { toast } = useToast();
  const onError = useApiErrorToast();

  const [filters, setFilters] = useState<KmRateFilters>({});
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<KmRate | null>(null);

  const list = useKmRates(filters, canView);
  const clients = useClients(canViewClients);
  const del = useDeleteKmRate();

  const clientName = (id: string | null) =>
    id ? clients.data?.find((c) => c.id === id)?.name ?? id.slice(0, 8) : 'All (global)';

  const columns: EffectiveColumn<KmRate>[] = useMemo(
    () => [
      { header: 'Stream', render: (r) => <Badge tone={r.stream === 'rep' ? 'info' : 'neutral'}>{STREAM_LABEL[r.stream] ?? r.stream}</Badge> },
      { header: 'Client', render: (r) => clientName(r.client_id) },
      { header: 'Rate ($/km)', align: 'right', render: (r) => <span className="mono">{r.rate_per_km}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients.data],
  );

  if (!canView || isForbidden(list.error)) {
    return <AccessDenied message="Managing km rates requires the km rates permission." />;
  }

  const confirmDelete = () => {
    if (!toDelete) return;
    del.mutate(toDelete.id, {
      onSuccess: () => {
        toast({ title: 'KM rate deleted', tone: 'success' });
        setToDelete(null);
      },
      onError,
    });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="KM rates"
        subtitle="Per-client, effective-dated kilometre rate. Rep rows are reimbursed to reps; client-bill rows are charged to the client — the two streams are never combined."
        actions={
          canEdit ? (
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setAdding(true)}>
              Add rate
            </Button>
          ) : undefined
        }
      />

      {/* The origin every km log starts from — measured in the same place the rate is priced. */}
      <OfficeOriginCard />

      <Card>
        <div className={styles.filters}>
          <Select
            options={[
              { value: '__all__', label: 'All streams' },
              { value: 'rep', label: 'Rep' },
              { value: 'client_bill', label: 'Client bill' },
            ]}
            value={filters.stream ?? '__all__'}
            onValueChange={(v) => setFilters((f) => ({ ...f, stream: v === '__all__' ? undefined : (v as KmRate['stream']) }))}
            aria-label="Filter by stream"
          />
        </div>
        <DataState
          isLoading={list.isLoading}
          isError={list.isError}
          isEmpty={(list.data?.length ?? 0) === 0}
          onRetry={() => void list.refetch()}
          emptyNode={<p className="mono">No km rates configured — reps are paid the $0.45 default until one is added.</p>}
        >
          <EffectiveDatedTable
            rows={list.data ?? []}
            columns={columns}
            rowActions={
              canEdit
                ? (r) =>
                    r.status === 'pending' ? (
                      <IconButton label="Delete pending rate" icon={<Trash2 size={15} />} variant="outline" size="sm" onClick={() => setToDelete(r)} />
                    ) : null
                : undefined
            }
          />
        </DataState>
      </Card>

      <KmRateModal open={adding} onClose={() => setAdding(false)} />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete pending km rate"
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={confirmDelete}
      >
        This removes the pending rate and re-opens any predecessor it had bounded. Current and past rates
        can’t be deleted — supersede them with a new future-dated rate instead.
      </ConfirmDialog>
    </div>
  );
}
