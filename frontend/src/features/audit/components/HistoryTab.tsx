/**
 * HistoryTab — a reusable per-record audit history for detail screens (the Batch-1 deferred item). Queries
 * /v1/audit-logs?entity_type=&entity_id= (audit:view, Super Admin). Renders a newest-first timeline; each
 * entry reads as "Field: before → after" in plain words (`historyDiff`), with the raw JSON one click away for
 * an audit. Degrades to a muted note for callers without audit:view. — arch §security
 * 2026-11-18: the panel used to print raw JSON with internal ids ("rep_id": "95c4…"); it now reads as text.
 */
import { Fragment, useState } from 'react';
import { Avatar, Badge } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useRecordHistory } from '../api/useAuditLogs';
import { actionLabel, describeChanges } from '../historyDiff';
import styles from './HistoryTab.module.css';

const when = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const EMPTY = '—';

export function HistoryTab({ entityType, entityId }: { entityType: string; entityId: string | undefined }) {
  const canView = useCan('audit:view');
  const history = useRecordHistory(entityType, entityId, canView);
  const [rawOpen, setRawOpen] = useState<string | null>(null);

  if (!canView) {
    return <p className={styles.note}>The change history for this record is visible to Super Admins.</p>;
  }

  const rows = history.data ?? [];
  return (
    <DataState
      isLoading={history.isLoading}
      isError={history.isError}
      isEmpty={rows.length === 0}
      onRetry={() => history.refetch()}
      emptyNode={<p className={styles.note}>No recorded changes for this record.</p>}
    >
      <ol className={styles.list}>
        {rows.map((e) => {
          const changes = describeChanges(e.before_json, e.after_json);
          const showRaw = rawOpen === e.id;
          const hasRaw = !!e.before_json || !!e.after_json;
          return (
            <li key={e.id} className={styles.entry}>
              <div className={styles.head}>
                <Badge tone="neutral">{actionLabel(e.action)}</Badge>
                <Avatar name={e.actor?.full_name ?? 'System'} src={e.actor?.avatar_url} size="sm" />
                <span className={styles.actor}>{e.actor?.full_name ?? 'System'}</span>
                <span className={`mono ${styles.when}`}>{when(e.created_at)}</span>
              </div>

              {changes.length > 0 && (
                <dl className={styles.changes}>
                  {changes.map((c) => (
                    <Fragment key={c.field}>
                      <dt>{c.field}</dt>
                      <dd>
                        {c.before !== null && (
                          <>
                            <span className={styles.before}>{c.before}</span>
                            <span className={styles.arrow} aria-label="changed to">
                              →
                            </span>
                          </>
                        )}
                        <span>{c.after ?? EMPTY}</span>
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              )}

              {hasRaw && (
                <button
                  type="button"
                  className={styles.toggle}
                  aria-expanded={showRaw}
                  onClick={() => setRawOpen(showRaw ? null : e.id)}
                >
                  {showRaw ? 'Hide technical details' : 'Technical details'}
                </button>
              )}
              {showRaw && (
                <div className={styles.raw}>
                  <div>
                    <div className={styles.rawLabel}>Before</div>
                    <pre className={`mono ${styles.pre}`}>{e.before_json ? JSON.stringify(e.before_json, null, 2) : EMPTY}</pre>
                  </div>
                  <div>
                    <div className={styles.rawLabel}>After</div>
                    <pre className={`mono ${styles.pre}`}>{e.after_json ? JSON.stringify(e.after_json, null, 2) : EMPTY}</pre>
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
