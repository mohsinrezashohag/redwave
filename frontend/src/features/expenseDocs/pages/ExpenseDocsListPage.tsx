/**
 * ExpenseDocsListPage — /billing/expense-documents. The EXPENSE-billing surface: list generated client expense
 * documents (km + food, every version, filter by client + period) and trigger generation. The UI prices
 * nothing and shows NO commission data (#3); every amount is the server's via money(). Re-download renders the
 * PDF from the frozen record. `billing:view` to see; `billing:create` to generate. 403 → AccessDenied; the
 * server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ReceiptText } from 'lucide-react';
import { Badge, Button, IconButton, PageHeader, useToast } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { usePayPeriods } from '../../payrun/api/usePayRun';
import { useExpenseDocs } from '../api/useExpenseDocs';
import { downloadExpenseDocPdf, expenseDocNo } from '../expenseDocs.download';
import { ClientPeriodPicker } from '../../billing/components/ClientPeriodPicker';
import { GenerateExpenseDocModal } from '../components/GenerateExpenseDocModal';
import type { ClientExpenseDocument } from '../expenseDocs.types';
import styles from '../components/expenseDocs.module.css';

export default function ExpenseDocsListPage() {
  const canView = useCan('billing:view');
  const canCreate = useCan('billing:create');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const [clientId, setClientId] = useState<string | undefined>();
  const [periodId, setPeriodId] = useState<string | undefined>();
  const [generateOpen, setGenerateOpen] = useState(false);

  const clientsQ = useClients('all', canView);
  const periodsQ = usePayPeriods(canView);
  const q = useExpenseDocs({ client_id: clientId, pay_period_id: periodId }, canView);

  const clientName = useMemo(() => {
    const m = new Map((clientsQ.data ?? []).map((c) => [c.id, `${c.name} (${c.client_code})`]));
    return (id: string) => m.get(id) ?? '—';
  }, [clientsQ.data]);
  const periodLabel = useMemo(() => {
    const m = new Map((periodsQ.data ?? []).map((p) => [p.id, `#${p.period_number}`]));
    return (id: string) => m.get(id) ?? '—';
  }, [periodsQ.data]);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing billing requires the billing view permission." />;
  }

  const rows = q.data ?? [];

  const download = (id: string) =>
    downloadExpenseDocPdf(id).then(() => toast({ title: 'Document downloaded', tone: 'success' })).catch(onError);

  const columns: DataColumn<ClientExpenseDocument>[] = [
    { id: 'number', header: 'Document', render: (d) => <span className="mono">{expenseDocNo(d.document_number)}</span> },
    { id: 'client', header: 'Client', render: (d) => clientName(d.client_id) },
    { id: 'period', header: 'Period', render: (d) => <span className="mono">{periodLabel(d.pay_period_id)}</span> },
    { id: 'status', header: 'Status', render: (d) => <Badge tone={d.status === 'issued' ? 'success' : 'neutral'}>{d.status}</Badge> },
    { id: 'total', header: 'Total', align: 'right', numeric: true, render: (d) => money(d.total_amount, d.currency) },
    { id: 'cad', header: 'CAD equiv.', align: 'right', numeric: true, render: (d) => (d.currency === 'CAD' ? '—' : money(d.amount_cad)) },
    { id: 'generated', header: 'Generated', render: (d) => <span className="mono">{displayDate(d.generated_at)}</span> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Client Expense Documents"
        subtitle="Generate and view the per-client expense billing document (kilometres + food, per rep/day). Priced by the server from the client-bill km rate + native-currency food — no receipts, no commission. This screen computes nothing."
        actions={
          canCreate ? (
            <Button variant="primary" leftIcon={<ReceiptText size={16} />} onClick={() => setGenerateOpen(true)}>
              Generate document
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

      <DataTable<ClientExpenseDocument>
        columns={columns}
        rows={rows}
        getRowId={(d) => d.id}
        page={1}
        pageCount={1}
        total={rows.length}
        limit={Math.max(rows.length, 1)}
        onPageChange={() => {}}
        rowActions={(d) => (
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <Link to={`/billing/expense-documents/${d.id}`}>View</Link>
            <IconButton label="Download PDF" icon={<Download size={15} />} onClick={() => download(d.id)} />
          </span>
        )}
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No expense documents generated for this filter.</p>}
        aria-label="Expense documents"
      />

      <GenerateExpenseDocModal
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
