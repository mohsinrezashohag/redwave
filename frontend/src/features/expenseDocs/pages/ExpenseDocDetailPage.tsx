/**
 * ExpenseDocDetailPage — /billing/expense-documents/:id. Renders the immutable, gapless-numbered expense
 * document (km + food grouped per rep/day, the server total, in the client's currency) from the FROZEN
 * line_detail. The UI prices nothing and shows NO commission data (#3). Download re-renders the PDF from the
 * frozen record; export records an artifact. "Issue new version" creates a NEW numbered document (the current
 * one is kept, superseded). `billing:view`; create/export gate the actions.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, PageHeader, StatCard, TableError, TableSkeleton, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { usePayPeriods } from '../../payrun/api/usePayRun';
import { useExpenseDoc } from '../api/useExpenseDocs';
import { downloadExpenseDocPdf, exportExpenseDocPdf, expenseDocNo } from '../expenseDocs.download';
import { ExpenseDocLinesTable } from '../components/ExpenseDocLinesTable';
import { GenerateExpenseDocModal } from '../components/GenerateExpenseDocModal';
import styles from '../components/expenseDocs.module.css';

export default function ExpenseDocDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canView = useCan('billing:view');
  const canCreate = useCan('billing:create');
  const canExport = useCan('billing:export');

  const docQ = useExpenseDoc(id, canView);
  const doc = docQ.data;
  const clientsQ = useClients('all', canView);
  const periodsQ = usePayPeriods(canView);
  const [regenOpen, setRegenOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!canView || isForbidden(docQ.error)) {
    return <AccessDenied message="Viewing billing requires the billing view permission." />;
  }
  if (docQ.isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Expense document" />
        <TableSkeleton rows={5} columns={4} />
      </div>
    );
  }
  if (docQ.isError || !doc) {
    return (
      <div className={styles.page}>
        <PageHeader title="Expense document" />
        <TableError message="Couldn't load this expense document." onRetry={() => docQ.refetch()} />
      </div>
    );
  }

  const client = (clientsQ.data ?? []).find((c) => c.id === doc.client_id);
  const period = (periodsQ.data ?? []).find((p) => p.id === doc.pay_period_id);
  const clientName = client ? `${client.name} (${client.client_code})` : '—';
  const lines = doc.line_detail ?? [];

  const run = (fn: () => Promise<void>, okTitle: string) => {
    setDownloading(true);
    fn().then(() => toast({ title: okTitle, tone: 'success' })).catch(onError).finally(() => setDownloading(false));
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.detailHead}>
            <span className="mono">{expenseDocNo(doc.document_number)}</span> · {clientName}{' '}
            <Badge tone={doc.status === 'issued' ? 'success' : 'neutral'}>{doc.status}</Badge>
          </span>
        }
        subtitle={period ? `#${period.period_number} · ${displayDate(period.start_date)}–${displayDate(period.end_date)} · generated ${displayDate(doc.generated_at)} · ${doc.currency}` : `generated ${displayDate(doc.generated_at)}`}
        actions={
          <>
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate('/billing/expense-documents')}>
              Expense docs
            </Button>
            {canCreate && (
              <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => setRegenOpen(true)}>
                Issue new version
              </Button>
            )}
            <Button variant="primary" leftIcon={<FileDown size={16} />} loading={downloading} onClick={() => run(() => downloadExpenseDocPdf(doc.id), 'Document downloaded')}>
              Download PDF
            </Button>
            {canExport && (
              <Button variant="secondary" leftIcon={<FileDown size={16} />} loading={downloading} onClick={() => run(() => exportExpenseDocPdf(doc.id), 'Document exported')}>
                Export (record)
              </Button>
            )}
          </>
        }
      />

      {doc.status === 'superseded' && (
        <Card>
          <p className="mono" style={{ color: 'var(--text-secondary)' }}>
            This is a superseded version, kept for the audit trail. A newer document has replaced it as the current one.
          </p>
        </Card>
      )}

      <div className={styles.summary}>
        <StatCard label={`Total (${doc.currency})`} value={money(doc.total_amount, doc.currency)} />
        {doc.currency !== 'CAD' && <StatCard label="CAD equivalent" value={money(doc.amount_cad)} />}
        <StatCard label="Lines" value={String(lines.length)} />
      </div>

      <Card title="Kilometres + food — one line per rep per day">
        {lines.length === 0 ? (
          <p className="mono">This document has no billable kilometres or food for the period.</p>
        ) : (
          <ExpenseDocLinesTable lines={lines} currency={doc.currency} />
        )}
        <p className={styles.note}>No receipts, no commission data (#3). Kilometres are priced from the client-bill km rate; food at its native amount, in {doc.currency}.</p>
      </Card>

      <GenerateExpenseDocModal
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        clients={clientsQ.data ?? []}
        periods={periodsQ.data ?? []}
        presetClientId={doc.client_id}
        presetPeriodId={doc.pay_period_id}
      />
    </div>
  );
}
