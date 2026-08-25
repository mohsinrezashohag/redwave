/**
 * BulkGenerateModal — issue EVERY active client's statement for one billing week in a single action
 * (packet 06). Before this, an operator generated them one at a time by hand.
 *
 * A PARTIAL result is the normal outcome, not an error: one client whose product has no effective rate
 * fails alone while the rest issue. So the result is presented as three explicit groups — issued, skipped,
 * failed — and each failure keeps its `unpriced[]` detail, linking straight to the rate screen that fixes
 * it (the same affordance as UnpricedBanner) rather than burying a 422 in a toast (§13.5).
 *
 * The UI prices NOTHING (#1/#3) — every number here is the server's. Re-running is safe: already-issued
 * clients are skipped server-side, never renumbered, so this is not a bulk RE-issue. Correcting an issued
 * statement stays the deliberate per-client action. billing:create-gated; the server is the real gate (§5).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, SkipForward } from 'lucide-react';
import { Banner, Button, FormField, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { useGenerateAllStatements } from '../api/useBillingMutations';
import { statementNo } from '../billing.logic';
import styles from './billing.module.css';
import type { BillingPeriod, BulkStatementResult, UnpricedDetail } from '../billing.types';

interface Props {
  open: boolean;
  onClose: () => void;
  periods: BillingPeriod[];
  presetPeriodId?: string;
}

/** The failure's structured detail, when the cause was an unpriced product. */
function unpricedOf(failure: { unpriced?: unknown }): UnpricedDetail[] {
  return Array.isArray(failure.unpriced) ? (failure.unpriced as UnpricedDetail[]) : [];
}

export function BulkGenerateModal({ open, onClose, periods, presetPeriodId }: Props) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const [periodId, setPeriodId] = useState<string | undefined>(presetPeriodId);
  const [result, setResult] = useState<BulkStatementResult | null>(null);
  const mut = useGenerateAllStatements();

  useEffect(() => {
    if (open) {
      setPeriodId(presetPeriodId);
      setResult(null);
    }
  }, [open, presetPeriodId]);

  const run = () => {
    if (!periodId) return;
    mut.mutate(
      { periodId },
      {
        onSuccess: (data) => {
          setResult(data);
          // Report what actually happened — never "done" over a partial run.
          if (data.failed.length > 0) {
            toast({
              title: `${data.generated.length} issued, ${data.failed.length} failed`,
              description: 'Fix the rates below, then run again — issued statements are skipped.',
              tone: 'warning',
            });
          } else if (data.generated.length === 0) {
            toast({ title: 'Nothing to issue — every client already has a statement for this week', tone: 'info' });
          } else {
            toast({ title: `${data.generated.length} statements issued`, tone: 'success' });
          }
        },
        onError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !mut.isPending && onClose()}
      title="Generate all statements"
      size="lg"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={mut.isPending}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button variant="primary" type="button" onClick={run} disabled={!periodId} loading={mut.isPending}>
              Generate all
            </Button>
          )}
          {result && result.failed.length > 0 && (
            <Button variant="primary" type="button" onClick={() => setResult(null)}>
              Run again
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.form}>
        {!result && (
          <>
            <FormField label="Billing week">
              <Select
                placeholder="Select a billing week"
                value={periodId}
                onValueChange={setPeriodId}
                options={periods.map((p) => ({
                  value: p.id,
                  label: `Bill ${p.period_number} — ${displayDate(p.start_date)} to ${displayDate(p.end_date)}`,
                }))}
              />
            </FormField>
            <p className={styles.note}>
              Issues a statement for <strong>every active client</strong> with sales in this week. A client
              that already has a statement is <strong>skipped</strong> — nothing is renumbered or replaced.
              If one client is missing a billing rate, it fails on its own and the others still issue.
            </p>
          </>
        )}

        {result && (
          <div className={styles.bulkResult}>
            <Banner
              tone={result.failed.length > 0 ? 'warning' : 'success'}
              title={`Bill ${result.period_number} — ${result.generated.length} issued, ${result.skipped.length} skipped, ${result.failed.length} failed`}
            >
              {result.total_clients} active {result.total_clients === 1 ? 'client' : 'clients'} considered.
            </Banner>

            {result.generated.length > 0 && (
              <section>
                <h4 className={styles.bulkHeading}>
                  <CheckCircle2 size={15} aria-hidden /> Issued
                </h4>
                <ul className={styles.bulkList}>
                  {result.generated.map((g) => (
                    <li key={g.client_id}>
                      <Link to={`/billing/${g.statement_id}`}>{statementNo(g.statement_number)}</Link> — {g.client_code}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.skipped.length > 0 && (
              <section>
                <h4 className={styles.bulkHeading}>
                  <SkipForward size={15} aria-hidden /> Already issued — skipped
                </h4>
                <ul className={styles.bulkList}>
                  {result.skipped.map((s) => (
                    <li key={s.client_id}>
                      {s.client_code} —{' '}
                      {s.statement_number === null ? 'existing statement' : statementNo(s.statement_number)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.failed.length > 0 && (
              <section>
                <h4 className={styles.bulkHeading}>
                  <AlertTriangle size={15} aria-hidden /> Failed — nothing was issued for these
                </h4>
                {result.failed.map((f) => {
                  const unpriced = unpricedOf(f);
                  return (
                    <div key={f.client_id} className={styles.bulkFailure}>
                      <strong>{f.client_code}</strong>
                      {unpriced.length > 0 ? (
                        <>
                          {' '}— add a billing rate in{' '}
                          <Link to={`/admin/clients/${f.client_id}`}>Clients &amp; Products</Link>, then run again:
                          <ul className={styles.unpricedList}>
                            {unpriced.map((u, i) => (
                              <li key={`${u.product_id}-${i}`}>
                                <code>{u.product_name}</code> — no rate effective on{' '}
                                <code>{displayDate(u.sale_date)}</code>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <span className={styles.subtle}> — {f.message}</span>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
