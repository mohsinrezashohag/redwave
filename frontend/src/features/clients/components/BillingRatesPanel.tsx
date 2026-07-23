/**
 * BillingRatesPanel — the effective-dating UI for a client's billing rates (#10). The whole panel is gated
 * on billing_rates:view (Super Admin only by default — sensitive partner financials; the server is the real
 * gate). A current/pending/past table (the shared EffectiveDatedTable) with filters; "Add rate"
 * (billing_rates:create) supersedes/bounds, and PENDING rows offer Edit (billing_rates:edit) / Delete
 * (billing_rates:delete). Money is exact-decimal via money(). Reads ONLY billing rates — never commission (#3).
 */
import { useState } from 'react';
import { Banner, Button, ConfirmDialog, SegmentedControl, Select, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { productTypeLabel } from '../../../lib/format/productType';
import { useClientBillingRates } from '../api/useClients';
import { useDeleteBillingRate } from '../api/useClientMutations';
import { EffectiveDatedTable, type EffectiveColumn } from '../../../components/ui';
import { BillingRateFormModal } from './BillingRateFormModal';
import { PriceChart } from './PriceChart';
import type { BillingRate, BillingRateFilters, Product, RateKind } from '../clients.types';
import styles from './clients.module.css';

const ALL = '__all__';
/** The price chart reads the UNFILTERED set; a stable ref keeps it one query key (shared with the default history view). */
const NO_FILTERS: BillingRateFilters = {};
type View = 'chart' | 'history';
const RATE_KIND_LABEL: Record<RateKind, string> = {
  product: 'Product rate',
  tv_addon: 'TV add-on',
  hp_addon: 'Home-phone add-on',
  bundle_bonus: 'Bundle bonus',
  spiff: 'Spiff',
};
const STATUS_OPTIONS = [
  { value: ALL, label: 'All statuses' },
  { value: 'current', label: 'Current' },
  { value: 'pending', label: 'Pending' },
  { value: 'past', label: 'Past' },
];

export function BillingRatesPanel({
  clientId,
  products,
  currency,
}: {
  clientId: string;
  products: Product[];
  /** The client's billing currency — rate amounts are in it (#12). */
  currency: string;
}) {
  const canView = useCan('billing_rates:view');
  const canCreate = useCan('billing_rates:create');
  const canEdit = useCan('billing_rates:edit');
  const canDelete = useCan('billing_rates:delete');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const remove = useDeleteBillingRate();

  const [view, setView] = useState<View>('chart');
  const [filters, setFilters] = useState<BillingRateFilters>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editRate, setEditRate] = useState<BillingRate | null>(null);
  const [deleteRate, setDeleteRate] = useState<BillingRate | null>(null);
  const q = useClientBillingRates(clientId, filters, canView && view === 'history');
  // The chart needs every status; with no filters this is the same query key as the default history view,
  // so TanStack serves it from one cache entry rather than fetching twice.
  const chartQ = useClientBillingRates(clientId, NO_FILTERS, canView && view === 'chart');

  // Hidden entirely without billing_rates:view — these are sensitive partner financials.
  if (!canView) {
    return (
      <Banner tone="info" title="Billing rates are restricted">
        You don’t have permission to view this client’s billing rate card.
      </Banner>
    );
  }

  const productName = (id: string | null) => (id ? products.find((p) => p.id === id)?.name ?? '—' : '—');
  // A bundle targets a trigger SET, not a product — show the trigger types (e.g. "Home Phone + TV"). — BILL-013
  const targetOf = (r: BillingRate) =>
    r.rate_kind === 'bundle_bonus' ? r.bundle_product_types.map(productTypeLabel).join(' + ') || '—' : productName(r.product_id);

  const columns: EffectiveColumn<BillingRate>[] = [
    { header: 'Rate kind', render: (r) => RATE_KIND_LABEL[r.rate_kind] },
    { header: 'Product / trigger', render: targetOf },
    { header: `Amount (${currency})`, align: 'right', render: (r) => money(r.amount, currency) },
  ];

  const onConfirmDelete = () => {
    if (!deleteRate) return;
    remove.mutate(
      { clientId, rateId: deleteRate.id },
      {
        onSuccess: () => { toast({ title: 'Billing rate deleted', tone: 'success' }); setDeleteRate(null); },
        onError: (e) => { onError(e); setDeleteRate(null); },
      },
    );
  };

  const rates = q.data ?? [];
  const showRowActions = canEdit || canDelete;

  if (view === 'chart') {
    return (
      <div>
        <div className={styles.filters}>
          <SegmentedControl
            options={[
              { value: 'chart', label: 'Current prices' },
              { value: 'history', label: 'Rate history' },
            ]}
            value={view}
            onChange={setView}
            size="sm"
            ariaLabel="Billing rate view"
          />
        </div>
        <DataState
          isLoading={chartQ.isLoading}
          isError={chartQ.isError}
          isEmpty={false}
          onRetry={() => chartQ.refetch()}
        >
          <PriceChart products={products} rates={chartQ.data ?? []} currency={currency} />
        </DataState>
        {canCreate && (
          <div className={styles.panelActions}>
            <Button variant="secondary" onClick={() => setAddOpen(true)}>
              Add rate
            </Button>
          </div>
        )}
        {canCreate && <BillingRateFormModal open={addOpen} clientId={clientId} products={products} currency={currency} onClose={() => setAddOpen(false)} />}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.filters}>
        <SegmentedControl
          options={[
            { value: 'chart', label: 'Current prices' },
            { value: 'history', label: 'Rate history' },
          ]}
          value={view}
          onChange={setView}
          size="sm"
          ariaLabel="Billing rate view"
        />
        <div className={styles.filterControl}>
          <Select
            aria-label="Product filter"
            options={[{ value: ALL, label: 'All products' }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
            value={filters.productId ?? ALL}
            onValueChange={(v) => setFilters((f) => ({ ...f, productId: v === ALL ? undefined : v }))}
          />
        </div>
        <div className={styles.filterControl}>
          <Select
            aria-label="Rate kind filter"
            options={[{ value: ALL, label: 'All rate kinds' }, ...Object.entries(RATE_KIND_LABEL).map(([v, label]) => ({ value: v, label }))]}
            value={filters.rateKind ?? ALL}
            onValueChange={(v) => setFilters((f) => ({ ...f, rateKind: v === ALL ? undefined : (v as RateKind) }))}
          />
        </div>
        <div className={styles.filterControl}>
          <Select
            aria-label="Status filter"
            options={STATUS_OPTIONS}
            value={filters.status ?? ALL}
            onValueChange={(v) => setFilters((f) => ({ ...f, status: v === ALL ? undefined : (v as BillingRateFilters['status']) }))}
          />
        </div>
      </div>

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rates.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className={styles.supersedeNote}>No billing rates yet — add one to set what this client is charged.</p>}
      >
        <EffectiveDatedTable
          rows={rates}
          columns={columns}
          rowActions={
            showRowActions
              ? (r) =>
                  r.status === 'pending' ? (
                    <span className={styles.rowActions}>
                      {canEdit && (
                        <Button variant="tertiary" size="sm" onClick={() => setEditRate(r)}>
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="tertiary" size="sm" onClick={() => setDeleteRate(r)}>
                          Delete
                        </Button>
                      )}
                    </span>
                  ) : null
              : undefined
          }
        />
      </DataState>

      {canCreate && <BillingRateFormModal open={addOpen} clientId={clientId} products={products} currency={currency} onClose={() => setAddOpen(false)} />}
      {editRate && (
        <BillingRateFormModal open clientId={clientId} products={products} currency={currency} rate={editRate} onClose={() => setEditRate(null)} />
      )}
      <ConfirmDialog
        open={!!deleteRate}
        onOpenChange={(o) => !o && setDeleteRate(null)}
        title="Delete pending rate?"
        description="This removes the future-dated rate before it takes effect. The current rate stays in force."
        confirmLabel="Delete rate"
        loading={remove.isPending}
        onConfirm={onConfirmDelete}
      />

      {canCreate && (
        <div className={styles.panelActions}>
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            Add rate
          </Button>
        </div>
      )}
    </div>
  );
}
