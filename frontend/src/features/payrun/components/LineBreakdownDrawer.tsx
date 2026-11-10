/**
 * LineBreakdownDrawer — the per-rep "how this pay was computed" view. It restates the SERVER's line as a
 * labelled waterfall, from the commission BASIS down to net:
 *   gross − 30% held = 70% advance, then + released + incentives + expenses + bonus − clawback = net.
 * The +/−/= glyphs are presentation ONLY — no money is computed here (#1/#5); every figure, including gross
 * and the 30%, is a raw server string. The basis line (tier · internet tally · rate) explains how gross was
 * reached, so a "70% looks wrong" question is answerable here instead of by digging into sales. Below it,
 * the rep's holdback ledger (held vs released), with period labels joined from the schedule.
 */
import { Badge, Drawer, Table, TBody, TD, TH, THead, TR, type BadgeTone } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { money } from '../../../lib/format/money';
import { useHoldbackLedger } from '../api/usePayRun';
import { NetPayoutCell } from './NetPayoutCell';
import styles from './payrun.module.css';
import type { HoldbackReleaseStatus, PayPeriod, PayRunLine } from '../payrun.types';
import type { SplitLabels } from '../split';

const RELEASE_TONE: Record<HoldbackReleaseStatus, BadgeTone> = {
  held: 'neutral',
  scheduled: 'info',
  released: 'success',
};

function Row({ op, label, value }: { op: string; label: string; value: string | null }) {
  return (
    <div className={styles.bdRow}>
      <span className={styles.bdOp}>{op}</span>
      <span className={styles.bdLabel}>{label}</span>
      <span className={styles.bdValue}>{money(value)}</span>
    </div>
  );
}

/**
 * How gross was reached — tier, the gross internet tally that selected it, and the rate applied. All three
 * are the engine's, carried on the line; null on pre-reconciliation rows or when the tally is 0.
 *
 * Tier/rate are the value that is UNIFORM across the rep's internet activations. With per-client commission
 * schedules a rep can sell for two clients on different ladders — same tally, different rate — so the line
 * scalars come back null while each sale item keeps its own exact frozen tier and rate (#2). Say that,
 * rather than showing a bare "—". The TALLY itself is always cross-client (#5).
 */
function CommissionBasis({ line }: { line: PayRunLine }) {
  if (line.tier_at_payment === null && line.internet_tally === null) {
    return null;
  }
  const tally = line.internet_tally ?? 0;
  const mixedSchedules = line.tier_at_payment === null && tally > 0;
  return (
    <>
      <p className={styles.basis}>
        {line.tier_at_payment !== null ? (
          <>
            <strong>Tier {line.tier_at_payment}</strong> ·{' '}
          </>
        ) : mixedSchedules ? (
          <>Mixed client rates · </>
        ) : (
          <>No tier (no internet activations) · </>
        )}
        <span className="mono">{tally}</span> internet activation{tally === 1 ? '' : 's'}
        {line.rate_per_activation && (
          <>
            {' '}
            @ <span className="mono">{money(line.rate_per_activation)}</span> each
          </>
        )}
      </p>
      {mixedSchedules && (
        <p className={styles.footnote}>
          This rep sold for clients on different commission schedules, so no single tier or rate covers the
          line. The one tally above picked the bracket on each client&rsquo;s own schedule; every sale item
          carries its exact frozen tier and rate.
        </p>
      )}
    </>
  );
}

interface Props {
  line: PayRunLine | null;
  open: boolean;
  onClose: () => void;
  isDraft: boolean;
  periods: PayPeriod[];
  /** The split in force for this run — the arithmetic below is labelled with it, not a fixed 70/30. */
  labels: SplitLabels;
}

export function LineBreakdownDrawer({ line, open, onClose, isDraft, periods, labels }: Props) {
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
          <CommissionBasis line={line} />

          <div className={styles.breakdown}>
            {/* The split — gross is the base, the held share is withheld, the rest is paid now. */}
            <Row op="" label="Gross commission" value={line.gross_commission} />
            {!labels.holdsNothing && (
              <Row op="−" label={`Held back (${labels.heldPct}%, this period)`} value={line.amount_held} />
            )}
            <div className={`${styles.bdRow} ${styles.bdSubtotal}`}>
              <span className={styles.bdOp}>=</span>
              <span className={styles.bdLabel}>{labels.paid}</span>
              <span className={styles.bdValue}>{money(line.commission_70)}</span>
            </div>

            {/* What else composes this cycle's payout. */}
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
          {isDraft && !labels.holdsNothing && (
            <p className={styles.note}>The {labels.heldPct}% held above is recorded on the holdback ledger when the run is finalized.</p>
          )}
          <p className={styles.footnote}>
            Incentives are paid in full and are <strong>not</strong> part of the {labels.paidPct}/{labels.heldPct} base. Every amount
            here is the server&rsquo;s — nothing is calculated in this screen.
          </p>

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
