/**
 * RepStatementDrawer — one rep's pay statement for a finalized run: per sale, what it paid, their 70%, and
 * the 30% held. Admin-facing (`payrun:view`); the rep's own copy lives at /my-pay-statements and uses the
 * self-scoped endpoint that takes no repId at all.
 *
 * The UI computes NOTHING (#1). Every figure — including the totals — is the server's, read from the lines
 * frozen at finalize (#2). No client rate appears anywhere: a rep-facing document is the rep stream (#3).
 */
import { Drawer, TableError, TableSkeleton, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { useRepStatement } from '../api/usePayRun';
import styles from './payrun.module.css';

export function RepStatementDrawer({
  runId,
  repId,
  onClose,
}: {
  runId: string;
  repId: string | null;
  onClose: () => void;
}) {
  const q = useRepStatement(runId, repId ?? undefined, !!repId);
  const s = q.data;

  return (
    <Drawer open={!!repId} onOpenChange={(o) => !o && onClose()} title="Pay statement">
      {q.isLoading && <TableSkeleton rows={4} />}
      {q.isError && <TableError message="Could not load this statement." onRetry={() => q.refetch()} />}
      {s && (
        <div className={styles.summary}>
          <p className={styles.note}>
            <strong>{s.rep_name ?? s.rep_code}</strong> · Period {s.period_number} ·{' '}
            {displayDate(s.period_start)} – {displayDate(s.period_end)}
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Sale date</TH>
                <TH>Customer</TH>
                <TH>Product</TH>
                <TH align="right">Price</TH>
                <TH align="right">Your 70%</TH>
                <TH align="right">Held 30%</TH>
              </TR>
            </THead>
            <TBody>
              {s.lines.map((l) => (
                <TR key={l.sale_id}>
                  <TD>{l.sale_date ? displayDate(l.sale_date) : '—'}</TD>
                  <TD>{l.customer_name}</TD>
                  <TD>{l.product_name ?? '—'}</TD>
                  <TD numeric>{money(l.total_100)}</TD>
                  <TD numeric>{money(l.advance_70)}</TD>
                  <TD numeric>{money(l.holdback_30)}</TD>
                </TR>
              ))}
              <TR>
                <TD colSpan={3}>
                  <strong>Total</strong>
                </TD>
                <TD numeric>
                  <strong>{money(s.total_100)}</strong>
                </TD>
                <TD numeric>
                  <strong>{money(s.advance_70)}</strong>
                </TD>
                <TD numeric>
                  <strong>{money(s.holdback_30)}</strong>
                </TD>
              </TR>
            </TBody>
          </Table>
          {!s.is_finalized && (
            <p className={styles.note}>
              This run has not been finalized, so no amounts are frozen yet — nothing is owed for it.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
