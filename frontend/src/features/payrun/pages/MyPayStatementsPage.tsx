/**
 * MyPayStatementsPage — a rep's OWN pay statements. Answers the question Siam framed directly: "70% for
 * this sale, the price was $88, 70% of it, the other 30% held" — per sale, not a period summary.
 *
 * Every call is to the SELF-SCOPED endpoint, which takes no repId: the rep is resolved from the token, so
 * this screen cannot request anyone else's statement even if asked to. It shows no client rate, no margin
 * and no org-wide total (#3), and computes nothing (#1) — every figure is the server's, read from the lines
 * frozen at finalize (#2).
 *
 * Gated by `pay_statements:view`, which is grantable without any pay-run access.
 */
import { useState } from 'react';
import { Banner, Card, PageHeader, Table, TBody, TD, TH, THead, TR, TableError, TableSkeleton } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useMyPayStatement, useMyPayStatements } from '../api/usePayRun';
import { splitLabels } from '../split';
import styles from '../components/payrun.module.css';

export default function MyPayStatementsPage() {
  const canView = useCan('pay_statements:view');
  const [runId, setRunId] = useState<string | undefined>();
  const list = useMyPayStatements(canView);
  const statement = useMyPayStatement(runId, canView && !!runId);

  if (!canView) return <AccessDenied />;

  const runs = list.data ?? [];
  const selected = runId ?? runs[0]?.pay_run_id;
  const s = statement.data;
  // Each period is labelled with the split it was paid at (100% since 2026-11-11; 70/30 before).
  // No holdback since 2026-11-13; an OLD run that held some keeps its frozen 70% / 30% columns.
  const labels = splitLabels(s?.split);
  const old = !!s?.has_holdback;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader title="My pay statements" subtitle="What each sale paid you, period by period." />

      <Card title="Pay periods">
        {list.isLoading && <TableSkeleton rows={3} />}
        {list.isError && <TableError message="Could not load your statements." onRetry={() => list.refetch()} />}
        {!list.isLoading && runs.length === 0 && (
          <p className={styles.note}>No pay statements yet. One appears here after a pay run is finalized.</p>
        )}
        {runs.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Period</TH>
                <TH>Dates</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.pay_run_id} selected={r.pay_run_id === selected}>
                  {/* A real button, not a click handler on the row — keyboard-reachable and announced (§7). */}
                  <TD>
                    <button type="button" className={styles.linkButton} onClick={() => setRunId(r.pay_run_id)}>
                      Period {r.period_number}
                    </button>
                  </TD>
                  <TD>
                    {displayDate(r.period_start)} – {displayDate(r.period_end)}
                  </TD>
                  <TD>{r.run_status}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {selected && (
        <Card title={s ? `Period ${s.period_number}` : 'Statement'}>
          {statement.isLoading && <TableSkeleton rows={4} />}
          {statement.isError && (
            <TableError message="Could not load this statement." onRetry={() => statement.refetch()} />
          )}
          {s && !s.is_finalized && (
            <Banner tone="info" title="Not finalized yet">
              This period has not been finalized, so no amounts are frozen and nothing is owed for it yet.
            </Banner>
          )}
          {s && s.is_finalized && s.lines.length === 0 && (
            <Banner tone="info" title="Statement not available yet">
              This period was paid, but its statement lines have not been recorded. Your administrator can
              rebuild them from the frozen amounts. Please check back later.
            </Banner>
          )}
          {s && s.lines.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Sale date</TH>
                  <TH>Customer</TH>
                  <TH>Product</TH>
                  <TH align="right">{old ? 'Price' : 'Commission'}</TH>
                  {old && <TH align="right">Your {labels.paidPct}%</TH>}
                  {old && <TH align="right">{labels.held}</TH>}
                </TR>
              </THead>
              <TBody>
                {s.lines.map((l) => (
                  <TR key={l.sale_id}>
                    <TD>{l.sale_date ? displayDate(l.sale_date) : '—'}</TD>
                    <TD>{l.customer_name}</TD>
                    <TD>{l.product_name ?? '—'}</TD>
                    <TD numeric>{money(l.total_100)}</TD>
                    {old && <TD numeric>{money(l.advance_70)}</TD>}
                    {old && <TD numeric>{money(l.holdback_30)}</TD>}
                  </TR>
                ))}
                <TR>
                  <TD colSpan={3}>
                    <strong>Total</strong>
                  </TD>
                  <TD numeric>
                    <strong>{money(s.total_100)}</strong>
                  </TD>
                  {old && (
                    <TD numeric>
                      <strong>{money(s.advance_70)}</strong>
                    </TD>
                  )}
                  {old && (
                    <TD numeric>
                      <strong>{money(s.holdback_30)}</strong>
                    </TD>
                  )}
                </TR>
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
