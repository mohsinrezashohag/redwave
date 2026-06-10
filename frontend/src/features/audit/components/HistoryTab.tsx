/**
 * HistoryTab — a reusable per-record audit history for detail screens (the Batch-1 deferred item). Queries
 * /v1/audit-logs?entity_type=&entity_id= (audit:view, Super Admin). Renders a newest-first timeline; each
 * entry expands to before → after. Degrades to a muted note for callers without audit:view. — arch §security
 */
import { useState, type CSSProperties } from 'react';
import { Badge } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useRecordHistory } from '../api/useAuditLogs';

const when = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

export function HistoryTab({ entityType, entityId }: { entityType: string; entityId: string | undefined }) {
  const canView = useCan('audit:view');
  const history = useRecordHistory(entityType, entityId, canView);
  const [open, setOpen] = useState<string | null>(null);

  if (!canView) {
    return (
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        The change history for this record is visible to Super Admins.
      </p>
    );
  }

  const rows = history.data ?? [];
  return (
    <DataState
      isLoading={history.isLoading}
      isError={history.isError}
      isEmpty={rows.length === 0}
      onRetry={() => history.refetch()}
      emptyNode={<p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>No recorded changes for this record.</p>}
    >
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {rows.map((e) => {
          const isOpen = open === e.id;
          return (
            <li
              key={e.id}
              style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : e.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: 0,
                }}
              >
                <Badge tone="neutral">{e.action}</Badge>
                <span style={{ fontSize: 'var(--text-sm)' }}>{e.actor?.full_name ?? 'System'}</span>
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                  {when(e.created_at)}
                </span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 'var(--space-2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>Before</div>
                    <pre className="mono" style={preStyle}>{e.before_json ? JSON.stringify(e.before_json, null, 2) : '—'}</pre>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>After</div>
                    <pre className="mono" style={preStyle}>{e.after_json ? JSON.stringify(e.after_json, null, 2) : '—'}</pre>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </DataState>
  );
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 'var(--space-2)',
  background: 'var(--surface-sunken)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-xs)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 220,
  overflow: 'auto',
};
