/**
 * PayRunListPage — /pay-runs, "Commission reports". Client decision 2026-11-16: pay runs are no longer fixed
 * periods. The admin picks a sale-date range (optionally one client and/or one rep), generates a DRAFT report
 * and is routed to it. Below, the server-paginated history of every report: legacy pay-period runs and range
 * reports alike, each named by the server's `display_label`.
 *
 * The UI computes no money. `payrun:view` to see; `payrun:create` to generate. 403 → AccessDenied; the
 * server is the real gate (§5).
 */
import { Eye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, PageHeader, Select } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { NewReportForm } from '../components/NewReportForm';
import { PayRunStatusBadge } from '../components/PayRunStatusBadge';
import { usePayRunsTable, useReportClients, useReportReps, type PayRunSortKey } from '../api/usePayRun';
import { useDraftRun } from '../api/usePayRunMutations';
import { ALL, fromSentinel, scopeLabel, toCreateBody, type NewReportValues } from '../report.logic';
import type { PayRunFilters, PayRunKind, PayRunStatus, PayRunSummary } from '../payrun.types';
import styles from '../components/payrun.module.css';

const STATUS_OPTIONS = [
  { value: ALL, label: 'Any status' },
  { value: 'draft', label: 'Draft' },
  { value: 'finalized', label: 'Paid' },
  { value: 'exported', label: 'Paid and exported' },
];

const KIND_OPTIONS = [
  { value: ALL, label: 'All reports' },
  { value: 'range', label: 'Date-range reports' },
  { value: 'period', label: 'Pay periods (before Nov 2026)' },
];

export default function PayRunListPage() {
  const canView = useCan('payrun:view');
  const canCreate = useCan('payrun:create');
  const navigate = useNavigate();
  const onError = useApiErrorToast();
  const draft = useDraftRun();
  const clients = useReportClients(canView);
  const reps = useReportReps(canView);

  const [status, setStatus] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [clientId, setClientId] = useState(ALL);
  const [repId, setRepId] = useState(ALL);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Server-side search, committed after the user pauses typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo<PayRunFilters>(
    () => ({
      status: fromSentinel(status) as PayRunStatus | undefined,
      kind: fromSentinel(kind) as PayRunKind | undefined,
      client_id: fromSentinel(clientId),
      rep_id: fromSentinel(repId),
      search: search.trim() || undefined,
    }),
    [status, kind, clientId, repId, search],
  );
  const table = usePayRunsTable(filters, canView);

  if (!canView) {
    return <AccessDenied message="Viewing commission reports requires the pay-run view permission." />;
  }

  const onGenerate = (values: NewReportValues) =>
    draft.mutate(toCreateBody(values), {
      onSuccess: (run) => navigate(`/pay-runs/${run.id}`),
      onError,
    });

  const columns: DataColumn<PayRunSummary, PayRunSortKey>[] = [
    {
      id: 'report',
      header: 'Report',
      render: (r) => (
        <button type="button" className={styles.linkButton} onClick={() => navigate(`/pay-runs/${r.id}`)}>
          {r.display_label}
        </button>
      ),
    },
    {
      id: 'covers',
      header: 'Sale dates',
      sortKey: 'date_from',
      render: (r) => (
        <span className={styles.nowrap}>
          {displayDate(r.window_start)} to {displayDate(r.window_end)}
        </span>
      ),
    },
    { id: 'scope', header: 'Covers', render: (r) => scopeLabel(r) },
    { id: 'status', header: 'Status', sortKey: 'status', render: (r) => <PayRunStatusBadge status={r.status} /> },
    {
      id: 'created',
      header: 'Generated',
      sortKey: 'created_at',
      align: 'right',
      render: (r) => <span className="mono">{displayDate(r.run_date)}</span>,
    },
  ];

  const clientOptions = [
    { value: ALL, label: 'All clients' },
    ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];
  const repOptions = [
    { value: ALL, label: 'All reps' },
    ...(reps.data ?? []).map((r) => ({ value: r.id, label: r.name })),
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Commission reports"
        subtitle="Pick a sale-date range, review what each rep earned, then mark the report as paid. Every amount is calculated by the server."
      />

      {canCreate && <NewReportForm submitting={draft.isPending} onGenerate={onGenerate} />}

      <section className={styles.history} aria-label="Report history">
        <h2 className={styles.sectionTitle}>History</h2>
        <div className={styles.filters}>
          <Input
            type="search"
            placeholder="Search by name"
            aria-label="Search reports by name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select options={STATUS_OPTIONS} value={status} onValueChange={setStatus} aria-label="Status filter" />
          <Select options={KIND_OPTIONS} value={kind} onValueChange={setKind} aria-label="Report type filter" />
          <Select options={clientOptions} value={clientId} onValueChange={setClientId} aria-label="Client filter" />
          <Select options={repOptions} value={repId} onValueChange={setRepId} aria-label="Rep filter" />
        </div>
        <DataTable
          columns={columns}
          rows={table.rows}
          getRowId={(r) => r.id}
          sort={table.sort}
          onSortChange={table.toggleSort}
          page={table.page}
          pageCount={table.pageCount}
          total={table.total}
          limit={table.limit}
          onPageChange={table.setPage}
          isLoading={table.isLoading}
          isError={table.isError}
          error={table.error}
          onRetry={() => table.refetch()}
          forbiddenMessage="Viewing commission reports requires the pay-run view permission."
          emptyNode={<p className={styles.note}>No reports match these filters.</p>}
          rowActions={(r) => (
            <Button leftIcon={<Eye size={16} />} variant="secondary" size="sm" onClick={() => navigate(`/pay-runs/${r.id}`)}>
              {r.status === 'draft' ? 'Open draft' : 'View'}
            </Button>
          )}
        />
      </section>
    </div>
  );
}
