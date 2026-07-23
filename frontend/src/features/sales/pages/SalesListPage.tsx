/**
 * SalesListPage — the sales list + validation queue. Filter state (incl. free-text search) lives in the
 * URL search params (so a preset like `/sales?status=entered` is a shareable "Validation" link). Export
 * (CSV/Excel/PDF/Print) respects the active filters via a paged fetch-all. The "Enter sale" action is
 * gated by `sales:create` for convenience — the server still authorizes (CLAUDE §5). — SALE-001/007
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PageHeader } from '../../../components/ui';
import { Can } from '../../../auth/Can';
import { useCan } from '../../../auth/useCan';
import { ExportMenu } from '../../../components/data/ExportMenu';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { exportFilename } from '../../../lib/export/exportFilename';
import { displayDate, todayIso } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { saleExportRowAccessor } from '../saleExport';
import { SalesFilterBar } from '../components/SalesFilterBar';
import { SalesTable } from '../components/SalesTable';
import { fetchAllSales, useClients } from '../api/useSales';
import type { Sale, SaleStatus, SalesFilters } from '../sales.types';

const FILTER_KEYS = ['status', 'rep_id', 'client_id', 'date_from', 'date_to', 'search'] as const;

export default function SalesListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewClients = useCan('clients:view');
  const clients = useClients(canViewClients);
  const productTypes = useProductTypes('all');

  const filters = useMemo<SalesFilters>(() => {
    const status = searchParams.get('status') ?? undefined;
    return {
      status: status as SaleStatus | undefined,
      rep_id: searchParams.get('rep_id') ?? undefined,
      client_id: searchParams.get('client_id') ?? undefined,
      date_from: searchParams.get('date_from') ?? undefined,
      date_to: searchParams.get('date_to') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    };
  }, [searchParams]);

  const onChange = useCallback(
    (patch: Partial<SalesFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of FILTER_KEYS) {
            if (key in patch) {
              const value = patch[key];
              if (value) next.set(key, value);
              else next.delete(key);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? id;
  const clientCode = (id: string) => clients.data?.find((c) => c.id === id)?.client_code ?? '';

  // The export uses the CLIENT BILL's column shape — a flag and an amount per component — so a sales
  // export can be read beside a statement. The amounts are the FROZEN COMMISSION snapshot (what the rep
  // earned), blank until Pay Run freezes them; no client billing rate is read here (#3).
  const behaviourByType = new Map((productTypes.data ?? []).map((t) => [t.key, t.behaviour]));
  const row = saleExportRowAccessor(behaviourByType); // projects each sale once, not once per column
  const yesNo = (on: boolean) => (on ? 'Yes' : 'No');
  const amount = (value: string) => (value ? money(value) : ''); // blank ≠ $0.00 — it isn't priced yet
  const exportColumns: ExportColumn<Sale>[] = [
    { header: 'Sale ID', value: (s) => s.sale_code },
    { header: 'Sale date', value: (s) => displayDate(s.sale_date) },
    { header: 'Customer', value: (s) => s.customer_name },
    { header: 'Channel', value: (s) => clientCode(s.client_id) },
    { header: 'Client', value: (s) => clientName(s.client_id) },
    { header: 'Product', value: (s) => row(s).product_name },
    { header: 'Internet', value: (s) => yesNo(row(s).has_internet) },
    { header: 'TV', value: (s) => yesNo(row(s).has_tv) },
    { header: 'Home Phone', value: (s) => yesNo(row(s).has_home_phone) },
    { header: 'Internet rate', value: (s) => amount(row(s).internet_rate) },
    { header: 'TV rate', value: (s) => amount(row(s).tv_rate) },
    { header: 'HP rate', value: (s) => amount(row(s).hp_rate) },
    { header: 'Other', value: (s) => amount(row(s).other_total) },
    { header: 'Total', value: (s) => amount(row(s).total) },
    { header: 'Greenfield', value: (s) => yesNo(s.is_greenfield) },
    { header: 'Status', value: (s) => s.status },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Sales"
        subtitle="Enter activations, then validate them into the pay run."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <ExportMenu
              filename={exportFilename({
                source: 'sales',
                period: { from: filters.date_from, to: filters.date_to },
                generatedOn: todayIso(),
              })}
              title="Sales"
              columns={exportColumns}
              getRows={() => fetchAllSales(filters)}
            />
            <Can permission="sales:create">
              <Button variant="primary" onClick={() => navigate('/sales/new')}>
                Enter sale
              </Button>
            </Can>
          </div>
        }
      />
      <SalesFilterBar filters={filters} onChange={onChange} />
      <SalesTable filters={filters} />
    </div>
  );
}
