/**
 * PayRunLinesTable — the REVIEW surface: one row per rep with the server-computed components and the net.
 * Money is right-aligned tabular-mono (TD numeric); the net uses NetPayoutCell (negative shown clearly).
 * A row's "details" opens the per-rep breakdown drawer. The footer totals are a DISPLAY sum (sumMoney —
 * integer cents, no float #1), never a recomputation. The UI computes no money (#1/#5).
 */
import { Gift, Search } from 'lucide-react';
import { Table, TBody, TD, TH, THead, TR, type MenuEntry } from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import { money, sumMoney } from '../../../lib/format/money';
import { NetPayoutCell } from './NetPayoutCell';
import styles from './payrun.module.css';
import type { PayRunLine } from '../payrun.types';

interface Props {
  lines: PayRunLine[];
  onSelect: (line: PayRunLine) => void;
  onBonus: (line: PayRunLine) => void;
  canBonus: boolean;
}

export function PayRunLinesTable({ lines, onSelect, onBonus, canBonus }: Props) {
  const total = (pick: (l: PayRunLine) => string) => sumMoney(lines.map(pick));
  const rowMenu = (l: PayRunLine): MenuEntry[] => {
    const items: MenuEntry[] = [{ label: 'View breakdown', icon: <Search size={15} />, onSelect: () => onSelect(l) }];
    if (canBonus) items.push('separator', { label: 'Set bonus', icon: <Gift size={15} />, onSelect: () => onBonus(l) });
    return items;
  };
  return (
    <Table>
      <THead>
        <TR>
          <TH>Rep</TH>
          <TH align="right">70% advance</TH>
          <TH align="right">Released</TH>
          <TH align="right">Incentives</TH>
          <TH align="right">Expenses</TH>
          <TH align="right">Bonus</TH>
          <TH align="right">Clawback</TH>
          <TH align="right">Net payout</TH>
          <TH align="right" aria-label="Details" />
        </TR>
      </THead>
      <TBody>
        {lines.map((l) => (
          <TR key={l.id}>
            <TD>
              <span className="mono">{l.rep.rep_code}</span> <span className={styles.note}>{l.rep.full_name}</span>
            </TD>
            <TD numeric>{money(l.commission_70)}</TD>
            <TD numeric>{money(l.holdback_release_30)}</TD>
            <TD numeric>{money(l.incentive_total)}</TD>
            <TD numeric>{money(l.expense_total)}</TD>
            <TD numeric>{money(l.bonus_amount)}</TD>
            <TD numeric>{money(l.clawback_total)}</TD>
            <TD numeric>
              <NetPayoutCell value={l.net_payout} />
            </TD>
            <TD align="right">
              <RowActions label={`Actions for ${l.rep.rep_code}`} items={rowMenu(l)} />
            </TD>
          </TR>
        ))}
        {lines.length > 1 && (
          <TR className={styles.bdTotal}>
            <TD>
              <strong>Total · {lines.length} reps</strong>
            </TD>
            <TD numeric>{money(total((l) => l.commission_70))}</TD>
            <TD numeric>{money(total((l) => l.holdback_release_30))}</TD>
            <TD numeric>{money(total((l) => l.incentive_total))}</TD>
            <TD numeric>{money(total((l) => l.expense_total))}</TD>
            <TD numeric>{money(total((l) => l.bonus_amount))}</TD>
            <TD numeric>{money(total((l) => l.clawback_total))}</TD>
            <TD numeric>
              <NetPayoutCell value={total((l) => l.net_payout)} />
            </TD>
            <TD align="right" />
          </TR>
        )}
      </TBody>
    </Table>
  );
}
