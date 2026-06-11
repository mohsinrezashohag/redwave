/**
 * ReportExportsPage — /reports/exports: ON-DEMAND report exports (SRS RPT-015; scheduling deferred §12).
 * Pick a report type → scope → format (CSV/Excel/PDF) → Generate: the data comes from the EXISTING
 * scope-enforced reads (rep=own, manager=roster, business=reports:business — the server scopes every
 * row), the record is written FIRST via POST /v1/report-exports (no record → no file; the server
 * re-enforces the per-type permission with 403 + audit), then the file is generated CLIENT-side by the
 * shared `exportRows` helper. The page lists only the types the caller's permissions allow — convenience
 * only, the server is the real gate (§5). This UI computes no money; every figure is server-sourced.
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Card,
  DatePicker,
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { exportRows, type ExportFormat } from '../../../lib/export/exportRows';
import { displayDate, todayIso } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { usePayPeriods, usePayRuns } from '../../payrun/api/usePayRun';
import { fetchAllExpenseItems } from '../../expenses/api/useExpenseItems';
import { useUsers } from '../../admin/api/useUsers';
import type { BusinessDashboard, Leaderboard } from '../../dashboards/dashboards.types';
import type { PayRun } from '../../payrun/payrun.types';
import {
  businessSummaryColumns,
  businessSummaryRows,
  expenseColumns,
  exportFilename,
  leaderboardColumns,
  payrunColumns,
  REPORT_TYPE_DEFS,
} from '../exportDefs';
import { useRecordReportExport, useReportExports } from '../api/useReportExports';
import type { ReportFormat, ReportType } from '../reports.types';
import styles from './reports.module.css';

const CURRENT = '__current__';
const FORMATS: { value: ReportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'excel', label: 'Excel' },
  { value: 'pdf', label: 'PDF' },
];

/** The API format → the exportRows format + the real file extension. */
const toUiFormat = (f: ReportFormat): ExportFormat => (f === 'excel' ? 'xlsx' : f);

export default function ReportExportsPage() {
  const { user, permissions } = useAuth();
  const { toast } = useToast();
  const onError = useApiErrorToast();

  // Only the report types the caller may export (the SAME per-type map the server enforces).
  const available = useMemo(() => REPORT_TYPE_DEFS.filter((d) => permissions.has(d.permission)), [permissions]);

  const [type, setType] = useState<ReportType | undefined>(available[0]?.type);
  const [periodId, setPeriodId] = useState<string>(CURRENT);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [format, setFormat] = useState<ReportFormat>('csv');
  const [busy, setBusy] = useState(false);

  const canViewPeriods = useCan('payrun:view');
  const canViewUsers = useCan('users:view');
  const periods = usePayPeriods(canViewPeriods && available.length > 0);
  const runs = usePayRuns(canViewPeriods && available.some((d) => d.type === 'payrun_summary'));
  const recent = useReportExports(available.length > 0);
  const users = useUsers(canViewUsers && available.length > 0);
  const record = useRecordReportExport();

  if (available.length === 0) {
    return <AccessDenied message="Report exports ride your existing export permissions — none of the report types are available to your role." />;
  }

  const def = REPORT_TYPE_DEFS.find((d) => d.type === type) ?? available[0];
  const periodOptions = [
    { value: CURRENT, label: 'Current period' },
    ...(periods.data ?? []).map((p) => ({
      value: p.id,
      label: `Period ${p.period_number} · ${displayDate(p.start_date)}–${displayDate(p.end_date)}`,
    })),
  ];

  /** The selected period's run (latest), for the pay-run summary. */
  const runForPeriod = (id: string) =>
    (runs.data ?? [])
      .filter((r) => r.pay_period_id === id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const chosenPeriod = periodId === CURRENT ? undefined : periodId;

      // 1) Fetch the rows from the EXISTING scope-enforced reads (the server scopes every row).
      let rows: unknown[] = [];
      let columns;
      let title = def.label;
      if (def.type === 'business_summary') {
        const d = await unwrap<BusinessDashboard>(
          api.GET('/v1/dashboards/business', { params: { query: chosenPeriod ? { pay_period_id: chosenPeriod } : {} } }),
        );
        rows = businessSummaryRows(d);
        columns = businessSummaryColumns;
      } else if (def.type === 'leaderboard') {
        const l = await unwrap<Leaderboard>(api.GET('/v1/leaderboard'));
        rows = l.rankings;
        columns = leaderboardColumns;
        title = l.period ? `${def.label} — period ${l.period.period_number}` : def.label;
      } else if (def.type === 'payrun_summary') {
        if (!chosenPeriod) {
          toast({ title: 'Pick a pay period', description: 'The pay-run summary needs a specific period.', tone: 'warning' });
          return;
        }
        const run = runForPeriod(chosenPeriod);
        if (!run) {
          toast({ title: 'No pay run for that period', description: 'Draft a run first — there is nothing to export yet.', tone: 'warning' });
          return;
        }
        const detail = await unwrap<PayRun>(api.GET('/v1/pay-runs/{id}', { params: { path: { id: run.id } } }));
        rows = detail.lines;
        columns = payrunColumns;
        title = `${def.label} — period ${detail.pay_period.period_number} (${detail.status})`;
      } else {
        rows = await fetchAllExpenseItems({ from: from || undefined, to: to || undefined });
        columns = expenseColumns;
      }

      if (rows.length === 0) {
        toast({ title: 'Nothing to export', description: 'No rows match that scope.', tone: 'info' });
        return;
      }

      // 2) Record FIRST (who/what/when — the audit trail; the server re-enforces the per-type permission).
      //    No record → no file.
      const base = exportFilename(def.type, todayIso());
      const filename = `${base}.${toUiFormat(format)}`;
      await record.mutateAsync({
        report_type: def.type,
        format,
        filename,
        ...(chosenPeriod && def.scope === 'period' ? { pay_period_id: chosenPeriod } : {}),
        ...(def.scope === 'date-range' && from ? { from } : {}),
        ...(def.scope === 'date-range' && to ? { to } : {}),
      });

      // 3) Generate + download client-side (the shared Batch-1 helper).
      await exportRows({
        format: toUiFormat(format),
        filename: base,
        columns: columns as never,
        rows: rows as never[],
        title,
      });
      toast({ title: 'Report exported', description: `${filename} · ${rows.length} row(s)`, tone: 'success' });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const userName = (id: string) =>
    id === user?.id ? 'You' : ((users.data ?? []).find((u) => u.id === id)?.full_name ?? '—');
  const typeLabel = (t: string) => REPORT_TYPE_DEFS.find((d) => d.type === t)?.label ?? t;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Report exports"
        subtitle="Generate and download reports. Every export is recorded (who, what, when); data is scoped to what your role may see."
      />

      <Card title="Generate a report">
        <div className={styles.controls}>
          <div className={styles.control}>
            <Select
              aria-label="Report type"
              options={available.map((d) => ({ value: d.type, label: d.label }))}
              value={def.type}
              onValueChange={(v) => setType(v as ReportType)}
            />
          </div>
          {def.scope === 'period' && canViewPeriods && (
            <div className={styles.control}>
              <Select aria-label="Pay period" options={periodOptions} value={periodId} onValueChange={setPeriodId} />
            </div>
          )}
          {def.scope === 'date-range' && (
            <>
              <div className={styles.control}>
                <DatePicker aria-label="From date" placeholder="From date" value={from} onChange={setFrom} />
              </div>
              <div className={styles.control}>
                <DatePicker aria-label="To date" placeholder="To date" value={to} onChange={setTo} />
              </div>
            </>
          )}
          <div className={styles.control}>
            <Select
              aria-label="Format"
              options={FORMATS}
              value={format}
              onValueChange={(v) => setFormat(v as ReportFormat)}
            />
          </div>
          <Button variant="primary" loading={busy} onClick={() => void generate()}>
            Generate &amp; download
          </Button>
        </div>
        <p className={styles.hint}>{def.description}</p>
        {def.type === 'payrun_summary' && periodId === CURRENT && (
          <Banner tone="info" title="Pick a period">
            The pay-run summary exports one period&apos;s run — choose the pay period above.
          </Banner>
        )}
      </Card>

      <Card title="Recent exports">
        <DataState
          isLoading={recent.isLoading}
          isError={recent.isError}
          isEmpty={(recent.data ?? []).length === 0}
          onRetry={() => void recent.refetch()}
          emptyNode={<p className={styles.hint}>No exports recorded yet.</p>}
        >
          <Table aria-label="Recent exports">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Report</TH>
                <TH>Format</TH>
                <TH>File</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {(recent.data ?? []).map((e) => (
                <TR key={e.id}>
                  <TD>{displayDate(e.generated_at)}</TD>
                  <TD>{typeLabel(e.report_type)}</TD>
                  <TD>
                    <Badge>{e.format.toUpperCase()}</Badge>
                  </TD>
                  <TD className="mono">{e.filename}</TD>
                  <TD>{userName(e.generated_by)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </DataState>
      </Card>

      <Banner tone="info" title="Scheduled exports">
        Recurring/scheduled report delivery is not built yet — exports here are generated on demand.
      </Banner>
    </div>
  );
}
