/**
 * LineBreakdownDrawer — the per-rep "how this pay was computed" view. It restates the SERVER's line as a
 * labelled waterfall: commission + incentives + expenses + bonus − clawback = net. The +/−/= glyphs are
 * presentation ONLY — no money is computed here (#1/#5); every figure is a raw server string. The basis line
 * (tier · internet tally · rate) explains how the commission was reached.
 *
 * No holdback since 2026-11-13. An OLD run that held or released some (hasHoldback) still shows its frozen
 * gross − held = paid split and the released amount, labelled with that run's own split, so it adds up.
 */
import { Drawer } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { NetPayoutCell } from './NetPayoutCell';
import styles from './payrun.module.css';
import type { PayRunLine } from '../payrun.types';
import type { SplitLabels } from '../split';

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
  /** An OLD run that held or released some: show its split and released rows. */
  hasHoldback: boolean;
  /** That old run's split labels. */
  labels: SplitLabels;
}

export function LineBreakdownDrawer({ line, open, onClose, hasHoldback, labels }: Props) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={line ? `${line.rep.rep_code} · ${line.rep.full_name}` : 'Breakdown'}>
      {line && (
        <>
          <CommissionBasis line={line} />

          <div className={styles.breakdown}>
            {hasHoldback ? (
              <>
                {/* An old 70/30 run: gross is the base, the held share was withheld, the rest was paid. */}
                <Row op="" label="Gross commission" value={line.gross_commission} />
                <Row op="−" label={`Held back (${labels.heldPct}%, this period)`} value={line.amount_held} />
                <div className={`${styles.bdRow} ${styles.bdSubtotal}`}>
                  <span className={styles.bdOp}>=</span>
                  <span className={styles.bdLabel}>{labels.paid}</span>
                  <span className={styles.bdValue}>{money(line.commission_70)}</span>
                </div>
                <Row op="+" label="Released holdback" value={line.holdback_release_30} />
              </>
            ) : (
              <Row op="" label="Commission" value={line.commission_70} />
            )}
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
          <p className={styles.footnote}>
            Incentives are paid in full. Every amount here comes from the server. Nothing is calculated on this
            screen.
          </p>
        </>
      )}
    </Drawer>
  );
}
