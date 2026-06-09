/**
 * ImportListPage — /import. The import batches with their state (staged / committed / …) + kind + counts, and
 * "New import" to start. `import:view` to see; `import:create` to start. 403 → AccessDenied; the server is the
 * real gate (§5).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { Button, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { DataState } from '../../../components/data/DataState';
import { isForbidden } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { useImports } from '../api/useImports';
import { ImportStatusBadge } from '../components/ImportStatusBadge';
import { TemplatesPanel } from '../components/TemplatesPanel';
import { kindOf } from '../import.types';
import styles from '../components/import.module.css';
import type { ImportBatchStatus } from '../import.types';

const ALL = '__all__';
const STATUS_OPTIONS = [
  { value: ALL, label: 'All statuses' },
  { value: 'staged', label: 'Staged' },
  { value: 'committed', label: 'Committed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function ImportListPage() {
  const canView = useCan('import:view');
  const canCreate = useCan('import:create');
  const canViewClients = useCan('clients:view');
  const navigate = useNavigate();
  const [status, setStatus] = useState<ImportBatchStatus | 'all'>('all');

  const q = useImports({ status: status === 'all' ? undefined : status }, canView);
  const clientsQ = useClients('all', canView && canViewClients);
  const clientName = useMemo(() => {
    const m = new Map((clientsQ.data ?? []).map((c) => [c.id, `${c.name} (${c.client_code})`]));
    return (clientId: string | null) => (clientId ? m.get(clientId) ?? '—' : '—');
  }, [clientsQ.data]);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing imports requires the import view permission." />;
  }

  const rows = q.data ?? [];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Data Import"
        subtitle="Stage a client report or migration, reconcile the rows, and commit. The server matches, gates, and applies atomically."
        actions={
          canCreate ? (
            <Button variant="primary" leftIcon={<Upload size={16} />} onClick={() => navigate('/import/new')}>
              New import
            </Button>
          ) : undefined
        }
      />

      <div className={styles.controls}>
        <div className={styles.control}>
          <Select options={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v === ALL ? 'all' : (v as ImportBatchStatus))} aria-label="Status filter" />
        </div>
      </div>

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No imports yet.</p>}
      >
        <Table>
          <THead>
            <TR>
              <TH>Kind</TH>
              <TH>Client</TH>
              <TH>Status</TH>
              <TH align="right">Matched / total</TH>
              <TH>Created</TH>
              <TH align="right" aria-label="View" />
            </TR>
          </THead>
          <TBody>
            {rows.map((b) => (
              <TR key={b.id}>
                <TD>{kindOf(b)?.label ?? `${b.source_type} · ${b.import_type}`}</TD>
                <TD>{clientName(b.client_id)}</TD>
                <TD>
                  <ImportStatusBadge status={b.status} />
                </TD>
                <TD numeric>
                  {b.matched_rows} / {b.total_rows}
                </TD>
                <TD>
                  <span className="mono">{displayDate(b.created_at)}</span>
                </TD>
                <TD align="right">
                  <Link to={`/import/${b.id}`}>View</Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>

      <TemplatesPanel />
    </div>
  );
}
