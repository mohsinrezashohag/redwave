/**
 * BillingListPage — /billing. The BILLING-stream surface: list generated client statements (every version,
 * filter by client + period) and trigger generation. The UI prices nothing and shows NO commission data
 * (#3); every amount is the server's via money(). Re-download renders the file from the frozen record.
 * `billing:view` to see; `billing:create` to generate. 403 → AccessDenied; the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText } from 'lucide-react';
import { Badge, Button, IconButton, PageHeader, useToast } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { useBillingPeriods, useStatements } from '../api/useBilling';
import { downloadStatementExcel } from '../billing.download';
import { statementNo } from '../billing.logic';
import { ClientPeriodPicker } from '../components/ClientPeriodPicker';
import { GenerateBillingModal } from '../components/GenerateBillingModal';
import type { ClientStatement } from '../billing.types';
import styles from '../components/billing.module.css';

export default function BillingListPage() {
  const canView = useCan('billing:view');
  const canCreate = useCan('billing:create');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const [clientId, setClientId] = useState<string | undefined>();
  const [periodId, setPeriodId] = useState<string | undefined>();
  const [generateOpen, setGenerateOpen] = useState(false);

  const clientsQ = useClients('all', canView);
  const periodsQ = useBillingPeriods(canView);
  const q = useStatements({ client_id: clientId, billing_period_id: periodId }, canView);

  const clientName = useMemo(() => {
    const m = new Map((clientsQ.data ?? []).map((c) => [c.id, `${c.name} (${c.client_code})`]));
    return (id: string) => m.get(id) ?? '—';
  }, [clientsQ.data]);
  const periodLabel = useMemo(() => {
    const m = new Map((periodsQ.data ?? []).map((p) => [p.id, `Bill ${p.period_number}`]));
    // A statement issued before weekly billing has no billing_period_id — it reads as "—", honestly.
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [periodsQ.data]);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing billing requires the billing view permission." />;
  }

  const rows = q.data ?? [];

  const download = (id: string) =>
    downloadStatementExcel(id).then(() => toast({ title: 'Statement downloaded', tone: 'success' })).catch(onError);

  const columns: DataColumn<ClientStatement>[] = [
    { id: 'number', header: 'Statement', render: (s) => <span className="mono">{statementNo(s.statement_number)}</span> },
    { id: 'client', header: 'Client', render: (s) => clientName(s.client_id) },
    { id: 'period', header: 'Billing week', render: (s) => <span className="mono">{periodLabel(s.billing_period_id)}</span> },
    { id: 'status', header: 'Status', render: (s) => <Badge tone={s.status === 'issued' ? 'success' : 'neutral'}>{s.status}</Badge> },
    { id: 'total', header: 'Total', align: 'right', numeric: true, render: (s) => money(s.total_amount, s.currency) },
    { id: 'generated', header: 'Generated', render: (s) => <span className="mono">{displayDate(s.generated_at)}</span> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Billing & Statements"
        subtitle="Generate and view what Redwave bills each program partner (CAD, no GST). Priced by the server from client billing rates — this screen computes nothing."
        actions={
          canCreate ? (
            <Button variant="primary" leftIcon={<FileText size={16} />} onClick={() => setGenerateOpen(true)}>
              Generate statement
            </Button>
          ) : undefined
        }
      />

      <ClientPeriodPicker
        clients={clientsQ.data ?? []}
        periods={periodsQ.data ?? []}
        clientId={clientId}
        periodId={periodId}
        onClient={setClientId}
        onPeriod={setPeriodId}
        allowAll
      />

      <DataTable<ClientStatement>
        columns={columns}
        rows={rows}
        getRowId={(s) => s.id}
        page={1}
        pageCount={1}
        total={rows.length}
        limit={Math.max(rows.length, 1)}
        onPageChange={() => {}}
        rowActions={(s) => (
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <Link to={`/billing/statements/${s.id}`}>View</Link>
            <IconButton label="Download Excel" icon={<Download size={15} />} onClick={() => download(s.id)} />
          </span>
        )}
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No statements generated for this filter.</p>}
        aria-label="Statements"
      />

      <GenerateBillingModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        clients={clientsQ.data ?? []}
        periods={periodsQ.data ?? []}
        presetClientId={clientId}
        presetPeriodId={periodId}
      />
    </div>
  );
}
