/**
 * SalesListPage — the sales list + validation queue. Filter state (incl. free-text search) lives in the
 * URL search params (so a preset like `/sales?status=entered` is a shareable "Validation" link). Export
 * (CSV/Excel/PDF/Print) respects the active filters and is RECORDED server-side first (sales export log,
 * 2026-11-11: who/when/which sales; "only sales not exported before"); it needs sales:export. The "Enter sale" action is
 * gated by `sales:create` for convenience — the server still authorizes (CLAUDE §5). — SALE-001/007
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PageHeader, saleStatusLabel } from '../../../components/ui';
import { Can } from '../../../auth/Can';
import { useCan } from '../../../auth/useCan';
import { ExportMenu } from '../../../components/data/ExportMenu';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { exportFilename } from '../../../lib/export/exportFilename';
import { displayDate, todayIso } from '../../../lib/format/date';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { saleExportRowAccessor } from '../saleExport';
import { SalesFilterBar } from '../components/SalesFilterBar';
import { SalesTable } from '../components/SalesTable';
import { useClients } from '../api/useSales';
import { useRecordSaleExport } from '../api/useSaleExports';
import { ExportHistory, ExportStatusLine } from '../components/SalesExportPanel';
import type { ExportFormat } from '../../../lib/export/exportRows';
import type { Sale, SaleStatus, SalesFilters } from '../sales.types';

const FILTER_KEYS = ['status', 'rep_id', 'client_id', 'date_from', 'date_to', 'search'] as const;

export default function SalesListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewClients = useCan('clients:view');
  const clients = useClients(canViewClients);
  const productTypes = useProductTypes('all');

  // Sales export log (2026-11-11): every export is recorded server-side BEFORE the file is built.
  const canExport = useCan('sales:export');
  const [onlyNew, setOnlyNew] = useState(false);
  const recordExport = useRecordSaleExport();
  // Gated on sales:export, the permission the log endpoint checks — every export is now recorded.

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
  // export can be read beside a statement. The amounts are the REP's rates: frozen once paid, else the rate
  // in force (Rate basis says which); no client billing rate is read here (#3). Money columns are plain
  // numbers in CSV/Excel so Redwave can do the tier / split maths there (2026-11-15). Address and other
  // detail columns are left off the PDF, which has no room for them.
  const behaviourByType = new Map((productTypes.data ?? []).map((t) => [t.key, t.behaviour]));
  const row = saleExportRowAccessor(behaviourByType); // projects each sale once, not once per column
  const yesNo = (on: boolean) => (on ? 'Yes' : 'No');
  const exportColumns: ExportColumn<Sale>[] = [
    { header: 'Sale ID', value: (s) => s.sale_code },
    { header: 'Sale date', value: (s) => displayDate(s.sale_date) },
    // The partner-facing Agent ID first, falling back to our internal code — the SAME pairing the client
    // statement freezes, so a sales export lines up against a bill agent-for-agent.
    { header: 'Agent ID', value: (s) => s.rep_external_code ?? s.rep_code ?? '' },
    { header: 'Agent Name', value: (s) => s.rep_name ?? '' },
    { header: 'Customer', value: (s) => s.customer_name },
    { header: 'Channel', value: (s) => clientCode(s.client_id) },
    // Channel already prints the client code; the full name only fits in CSV/Excel.
    { header: 'Client', value: (s) => clientName(s.client_id), pdf: false },
    { header: 'Product', value: (s) => row(s).product_name },
    { header: 'Internet', value: (s) => yesNo(row(s).has_internet) },
    { header: 'TV', value: (s) => yesNo(row(s).has_tv) },
    { header: 'Home Phone', value: (s) => yesNo(row(s).has_home_phone) },
    { header: 'Internet rate', value: (s) => row(s).internet_rate, money: true },
    { header: 'TV rate', value: (s) => row(s).tv_rate, money: true },
    { header: 'HP rate', value: (s) => row(s).hp_rate, money: true },
    { header: 'Other', value: (s) => row(s).other_total, money: true },
    { header: 'Total', value: (s) => row(s).total, money: true },
    { header: 'Incentive', value: (s) => row(s).incentive, money: true, pdf: false },
    // What clawbacks recovered from the sale (the rate columns keep showing what was paid). 2026-11-15
    { header: 'Clawed back', value: (s) => s.clawback_total ?? '', money: true },
    { header: 'Rate basis', value: (s) => row(s).rate_basis },
    { header: 'Greenfield', value: (s) => yesNo(s.is_greenfield) },
    { header: 'Status', value: (s) => saleStatusLabel(s.status) },
    {
      header: 'Pay period',
      value: (s) =>
        s.pay_period ? `#${s.pay_period.period_number} (${displayDate(s.pay_period.start_date)} to ${displayDate(s.pay_period.end_date)})` : '',
      pdf: false,
    },
    { header: 'Validated on', value: (s) => (s.validated_at ? displayDate(s.validated_at) : ''), pdf: false },
    { header: 'MPU ID', value: (s) => s.mpu_id ?? '', pdf: false },
    { header: 'Street', value: (s) => s.street, pdf: false },
    { header: 'City', value: (s) => s.city, pdf: false },
    { header: 'Province', value: (s) => s.province_state, pdf: false },
    { header: 'Postal code', value: (s) => s.postal_code, pdf: false },
  ];

  const exportFile = exportFilename({
    source: 'sales',
    period: { from: filters.date_from, to: filters.date_to },
    generatedOn: todayIso(),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Sales"
        subtitle="Enter activations, then validate them into the pay run."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {canExport && (
            <ExportMenu
              filename={exportFile}
              title="Sales"
              columns={exportColumns}
              getRows={async (format: ExportFormat) =>
                (
                  await recordExport.mutateAsync({
                    format,
                    filters,
                    onlyNew,
                    filename: exportFile,
                  })
                ).rows
              }
            />
            )}
            <Can permission="sales:create">
              <Button variant="primary" onClick={() => navigate('/sales/new')}>
                Enter sale
              </Button>
            </Can>
          </div>
        }
      />
      {canExport && <ExportStatusLine filters={filters} onlyNew={onlyNew} onOnlyNewChange={setOnlyNew} />}
      <SalesFilterBar filters={filters} onChange={onChange} />
      <SalesTable filters={filters} />
      {canExport && <ExportHistory />}
    </div>
  );
}
