/**
 * LineBreakdownDrawer — the per-rep "how this pay was computed" view. It restates the SERVER's line as a
 * labelled waterfall: commission + incentives + expenses + bonus − clawback = net. The +/−/= glyphs are
 * presentation ONLY — no money is computed here (#1/#5); every figure is a raw server string.
 *
 * No tiers and no 70/30 since 2026-11-13: the commission is the sum of each item's rep rate, frozen at
 * finalize, and the rep is paid it in full.
 */
import { Drawer } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { NetPayoutCell } from './NetPayoutCell';
import styles from './payrun.module.css';
import type { PayRunLine } from '../payrun.types';

function Row({ op, label, value }: { op: string; label: string; value: string | null }) {
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
}

export function LineBreakdownDrawer({ line, open, onClose }: Props) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={line ? `${line.rep.rep_code} · ${line.rep.full_name}` : 'Breakdown'}>
      {line && (
        <>
          <p className={styles.basis}>Each sale item pays its own rep rate; the commission is their total.</p>
          <div className={styles.breakdown}>
            <Row op="" label="Commission" value={line.commission} />
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
