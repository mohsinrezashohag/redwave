/**
 * AuditLogPage — the Super-Admin audit view (audit:view). A filterable, paginated DataTable over the
 * append-only audit_log; a row opens a drawer showing before → after. The data is read-only (no mutations).
 * — arch §security (audit)
 */
import { useState } from 'react';
import { Badge, Button, DatePicker, Drawer, FormField, Input, PageHeader } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useAuditTable } from '../api/useAuditLogs';
import type { AuditFilters, AuditLog, AuditSortKey } from '../audit.types';
import styles from './audit.module.css';

const when = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className={styles.json}>{value == null ? '—' : JSON.stringify(value, null, 2)}</pre>
);

export default function AuditLogPage() {
  const canView = useCan('audit:view');
  const [filters, setFilters] = useState<AuditFilters>({});
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const table = useAuditTable(filters, canView);

  if (!canView || isForbidden(table.error)) {
    return <AccessDenied message="The audit log requires the audit view permission (Super Admin)." />;
  }

  const set = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const columns: DataColumn<AuditLog, AuditSortKey>[] = [
    { id: 'created_at', header: 'When', sortKey: 'created_at', render: (r) => <span className="mono">{when(r.created_at)}</span> },
    { id: 'actor', header: 'Actor', render: (r) => r.actor?.full_name ?? r.user_id.slice(0, 8) },
    { id: 'action', header: 'Action', sortKey: 'action', render: (r) => <Badge tone="neutral">{r.action}</Badge> },
    { id: 'entity_type', header: 'Entity', sortKey: 'entity_type', render: (r) => r.entity_type },
    { id: 'entity_id', header: 'Record', render: (r) => <span className="mono">{r.entity_id.slice(0, 8)}</span> },
    { id: 'ip', header: 'IP', render: (r) => <span className="mono">{r.ip_address ?? '—'}</span> },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Audit log"
        subtitle="Every money & config mutation (and access denial) — actor, action, before → after, IP, timestamp. Append-only."
      />

      <div className={styles.filters}>
        <FormField label="Search">
          <Input placeholder="action or entity…" value={filters.search ?? ''} onChange={(e) => set({ search: e.target.value })} />
        </FormField>
        <FormField label="Entity type">
          <Input placeholder="e.g. pay_runs" value={filters.entity_type ?? ''} onChange={(e) => set({ entity_type: e.target.value })} />
        </FormField>
        <FormField label="Action">
          <Input placeholder="e.g. finalize" value={filters.action ?? ''} onChange={(e) => set({ action: e.target.value })} />
        </FormField>
        <FormField label="From">
          <DatePicker value={filters.date_from ?? ''} onChange={(v) => set({ date_from: v })} />
        </FormField>
        <FormField label="To">
          <DatePicker value={filters.date_to ?? ''} onChange={(v) => set({ date_to: v })} />
        </FormField>
        <div className={styles.clear}>
          <Button variant="tertiary" onClick={() => setFilters({})}>
            Clear
          </Button>
        </div>
      </div>

      <DataTable<AuditLog, AuditSortKey>
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
        rowActions={(r) => (
          <Button variant="tertiary" onClick={() => setDetail(r)}>
            View
          </Button>
        )}
        isLoading={table.isLoading}
        isError={table.isError}
        error={table.error}
        onRetry={() => table.refetch()}
        aria-label="Audit log"
      />

      <Drawer open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} title="Audit entry">
        {detail && (
          <div className={styles.detail}>
            <dl className={styles.meta}>
              <dt>When</dt><dd className="mono">{when(detail.created_at)}</dd>
              <dt>Actor</dt><dd>{detail.actor?.full_name ?? detail.user_id} {detail.actor?.email ? `· ${detail.actor.email}` : ''}</dd>
              <dt>Action</dt><dd>{detail.action}</dd>
              <dt>Entity</dt><dd>{detail.entity_type} · <span className="mono">{detail.entity_id}</span></dd>
              <dt>IP</dt><dd className="mono">{detail.ip_address ?? '—'}</dd>
            </dl>
            <h4 className={styles.diffHead}>Before</h4>
            <JsonBlock value={detail.before_json} />
            <h4 className={styles.diffHead}>After</h4>
            <JsonBlock value={detail.after_json} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
