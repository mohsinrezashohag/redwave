/**
 * The statement's summary strip — the counts + column totals that sit ABOVE the header row in the workbook
 * Redwave sends clients, and the same figures the detail screen shows.
 *
 * PURE. It only ADDS UP figures that were already priced and frozen on the lines — it never resolves a rate,
 * so it cannot disagree with the document (#1: exact decimal in, 2-dp strings out). Computing it here rather
 * than in the browser is what keeps the UI free of money arithmetic.
 *
 * The rendered Excel does NOT use this: its strip is live COUNTIF/SUBTOTAL formulas so the numbers follow the
 * user's filtering, exactly as the source workbook does. Same values, two audiences.
 * — docs/uat/billing-target-format.md
 */
import { formatMoney, sumMoney } from '../../common/money/money';

/** The money + flag fields of a frozen (or drafted) statement line, money as decimal strings. */
export interface SummarisableLine {
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  internet_rate: string;
  tv_rate: string;
  hp_rate: string;
  bundle_bonus: string;
  spiff: string;
  other_total: string;
  line_total: string;
}

export interface StatementSummary {
  line_count: number;
  internet_count: number;
  tv_count: number;
  home_phone_count: number;
  internet_total: string;
  tv_total: string;
  hp_total: string;
  bundle_total: string;
  spiff_total: string;
  other_total: string;
  grand_total: string;
}

const column = (lines: SummarisableLine[], pick: (l: SummarisableLine) => string): string =>
  formatMoney(sumMoney(lines.map(pick)));

export function summariseLines(lines: SummarisableLine[]): StatementSummary {
  return {
    line_count: lines.length,
    internet_count: lines.filter((l) => l.has_internet).length,
    tv_count: lines.filter((l) => l.has_tv).length,
    home_phone_count: lines.filter((l) => l.has_home_phone).length,
    internet_total: column(lines, (l) => l.internet_rate),
    tv_total: column(lines, (l) => l.tv_rate),
    hp_total: column(lines, (l) => l.hp_rate),
    bundle_total: column(lines, (l) => l.bundle_bonus),
    spiff_total: column(lines, (l) => l.spiff),
    other_total: column(lines, (l) => l.other_total),
    grand_total: column(lines, (l) => l.line_total),
  };
}
