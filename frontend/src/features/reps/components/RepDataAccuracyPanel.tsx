/**
 * RepDataAccuracyPanel — the rep's profile beside the HR-confirmed details of each ID on file (2026-11-13),
 * laid out like a passport office's comparison: one column per source, the same rows in each, read-only grey
 * value boxes, and any value that differs from the profile outlined in the warning tone. HR only (hrm:edit,
 * enforced by the server). The match flags come from the server; a value that isn't on file is never called
 * a mismatch. Tokens only.
 */
import { AlertTriangle } from 'lucide-react';
import { Badge, Banner } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useRepDataAccuracy } from '../api/useRepProfile';
import { ACCURACY_ROWS, accuracyColumns, accuracySummary, type AccuracyValue } from '../dataAccuracy';
import styles from './reps.module.css';

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v);

function Value({ cell }: { cell: AccuracyValue }) {
  if (cell.notApplicable) return <div className={styles.accuracyValueEmpty}>—</div>;
  const differs = cell.match === false;
  return (
    <div className={differs ? styles.accuracyValueDiffers : styles.accuracyValue}>
      {cell.value ? (
        <span className={isDate(cell.value) || cell.value.startsWith('••') ? 'mono' : undefined}>
          {isDate(cell.value) ? cell.value.slice(0, 10) : cell.value}
        </span>
      ) : (
        <span className={styles.muted}>Not on file</span>
      )}
      {differs && (
        <span className={styles.accuracyFlag}>
          <AlertTriangle size={14} aria-hidden /> Differs from profile
        </span>
      )}
    </div>
  );
}

export function RepDataAccuracyPanel({ repId }: { repId: string }) {
  const q = useRepDataAccuracy(repId);
  if (q.isError && isForbidden(q.error)) return <AccessDenied />;
  const data = q.data;
  const summary = data ? accuracySummary(data) : null;

  return (
    <DataState isLoading={q.isLoading} isError={q.isError} onRetry={() => void q.refetch()}>
      {data && summary && (
        <div className={styles.accuracy}>
          <Banner tone={summary.tone} title={summary.title}>
            {data.sources.length === 0
              ? 'Upload a passport, PR card, driver’s licence or permit under Documents and confirm its details to compare them here.'
              : 'Values come from the details HR confirmed on each document. A value that isn’t on file is not counted as a difference.'}
          </Banner>
          <div className={styles.accuracyGrid}>
            {accuracyColumns(data).map((col) => (
              <section key={col.id} className={styles.accuracyColumn} aria-label={col.title}>
                <header className={styles.accuracyHead}>
                  <h3 className={styles.sectionTitle}>{col.title}</h3>
                  {col.expired && <Badge tone="danger">Expired</Badge>}
                </header>
                <dl className={styles.accuracyRows}>
                  {ACCURACY_ROWS.map((row) => (
                    <div key={row.key} className={styles.accuracyRow}>
                      <dt>{row.label}</dt>
                      <dd>
                        <Value cell={col.cells[row.key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      )}
    </DataState>
  );
}
