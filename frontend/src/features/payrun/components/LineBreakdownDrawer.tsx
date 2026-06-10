/**
 * LineBreakdownDrawer — the per-rep "how this pay was computed" view. It restates the SERVER's line
 * components as a labelled waterfall (advance + released + expense + incentive + bonus − clawback = net);
 * the +/− and the equals are presentation only — no money is computed here (#1/#5). Below it, the rep's
 * holdback ledger (held vs released) read-only, with period labels joined from the schedule. The current
 * period's 30% held is NOT on the line — it lands on the ledger at finalize (a note says so during draft).
 * Tier & gross aren't carried on the line yet (a flagged backend follow-up).
 */
import { Badge, Drawer, Table, TBody, TD, TH, THead, TR, type BadgeTone } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { money } from '../../../lib/format/money';
import { useHoldbackLedger } from '../api/usePayRun';
import { NetPayoutCell } from './NetPayoutCell';
import styles from './payrun.module.css';
import type { HoldbackReleaseStatus, PayPeriod, PayRunLine } from '../payrun.types';

const RELEASE_TONE: Record<HoldbackReleaseStatus, BadgeTone> = {
  held: 'neutral',
  scheduled: 'info',
  released: 'success',
};

function Row({ op, label, value }: { op: string; label: string; value: string }) {
  return (
    <div className={styles.bdRow}>
      <span className={styles.bdOp}>{op}</span>
      <span className={styles.bdLabel}>{label}</span>
      <span className={styles.bdValue}>{money(value)}</span>
    </div>
  );
}

interface Props {
  line: PayRunLine | null;
  open: boolean;
  onClose: () => void;
  isDraft: boolean;
  periods: PayPeriod[];
}

export function LineBreakdownDrawer({ line, open, onClose, isDraft, periods }: Props) {
  const ledger = useHoldbackLedger({ rep_id: line?.rep_id }, open && !!line);
  const periodLabel = (id: string | null) => {
    if (!id) return '—';
    const p = periods.find((x) => x.id === id);
    return p ? `#${p.period_number}` : '—';
  };
  const rows = ledger.data ?? [];

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={line ? `${line.rep.rep_code} · ${line.rep.full_name}` : 'Breakdown'}>
      {line && (
        <>
          <div className={styles.breakdown}>
            <Row op="" label="70% advance" value={line.commission_70} />
            <Row op="+" label="Released holdback" value={line.holdback_release_30} />
            <Row op="+" label="Incentives" value={line.incentive_total} />
            <Row op="+" label="Expenses" value={line.expense_total} />
            <Row op="+" label="Bonus" value={line.bonus_amount} />
            <Row op="−" label="Clawback" value={line.clawback_total} />
            <div className={`${styles.bdRow} ${styles.bdTotal}`}>
              <span className={styles.bdOp}>=</span>
              <span className={styles.bdLabel}>Net payout</span>
              <span className={styles.bdValue}>
                <NetPayoutCell value={line.net_payout} />
              </span>
            </div>
          </div>

          {line.bonus_note && (
            <p className={styles.note}>
              Bonus note: <em>{line.bonus_note}</em>
            </p>
          )}
          {isDraft && <p className={styles.note}>The current period&rsquo;s 30% holdback is recorded when the run is finalized.</p>}
          <p className={styles.footnote}>Tier &amp; gross commission aren&rsquo;t carried on the pay-run line yet (a backend follow-up). Every amount shown is the server&rsquo;s.</p>

          <h3 className={styles.sectionTitle}>Holdback ledger</h3>
          <DataState
            isLoading={ledger.isLoading}
            isError={ledger.isError}
            isEmpty={rows.length === 0}
            onRetry={() => ledger.refetch()}
            emptyNode={<p className="mono">No holdback records for this rep yet.</p>}
          >
            <Table density="dense">
              <THead>
                <TR>
                  <TH align="right">Held</TH>
                  <TH>Origin</TH>
                  <TH>Releases into</TH>
                  <TH>Status</TH>
                  <TH align="right">Set-off</TH>
                  <TH align="right">Released</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((h) => (
                  <TR key={h.id}>
                    <TD numeric>{money(h.amount_held)}</TD>
                    <TD>
                      <span className="mono">{periodLabel(h.origin_pay_period_id)}</span>
                    </TD>
                    <TD>
                      <span className="mono">{periodLabel(h.scheduled_release_period_id)}</span>
                    </TD>
                    <TD>
                      <Badge tone={RELEASE_TONE[h.release_status]}>{h.release_status}</Badge>
                    </TD>
                    <TD numeric>{h.clawback_applied ? money(h.clawback_applied) : '—'}</TD>
                    <TD numeric>{money(h.amount_released)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </DataState>
        </>
      )}
    </Drawer>
  );
}
