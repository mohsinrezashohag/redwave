/**
 * Payroll-report aggregation — PURE & deterministic (no I/O, no Prisma, no dates, no clock).
 *
 * Builds Redwave's own payroll workbook line from the FROZEN commission snapshot: one row per SALE, with
 * the rep amount that each component actually earned, then the 70/30 split. It mirrors
 * `billing/statement.logic.ts` in shape and in nothing else — this is the REP-PAY stream.
 *
 * #3, and it is the whole point of the packet: this module has ZERO awareness of client billing. It reads
 * only amounts the service took from `sale_items.rate_applied` / `commission_paid`. Client 350 vs rep 125
 * on the same sale is the business model; joining them was the previous system's defect.
 *
 * #2 — every amount is the frozen snapshot, never recomputed. Rows therefore exist only once a pay run has
 * finalized, which is correct: before that no money is owed and a rendered number would be a guess.
 *
 * #9 — greenfield is flat-rated and excluded from the tier tally, so it is its OWN column rather than being
 * folded into internet. It and Spiff are the two ADDITIONS to Redwave's sheet, confirmed in Meeting 4.
 *
 * Money is exact decimal (decimal.js), never float (#1).
 * — docs/claude-code/02-payroll-report.md · docs/claude-code/system-audit.md §1.1
 */
import { Decimal } from 'decimal.js';

const ZERO = new Decimal(0);

/**
 * The per-component REP amounts the service read off one sale's frozen items. A component the sale does
 * not have is ZERO, not null — the workbook prints 0, and a null would be indistinguishable from "not yet
 * computed", which is a different thing entirely.
 */
export interface PayrollComponents {
  internet: Decimal;
  tv: Decimal;
  home_phone: Decimal;
  /** Greenfield internet — flat-rated, tally-excluded (#9). Separate from `internet` on purpose. */
  greenfield: Decimal;
  /** The frozen incentive across the sale's items (`sale_items.incentive_amount`). */
  spiff: Decimal;
  /** Any other priced item (Wireless / Protection Plan / Mesh / …) — never silently dropped. */
  other: Decimal;
}

export interface PayrollSaleInput {
  sale_id: string;
  sale_date: string; // 'YYYY-MM-DD'
  /** The partner-facing agent id (`Redwave11`); null when the rep has no external code yet. */
  rep_external_code: string | null;
  rep_code: string;
  rep_name: string;
  /** ONE column in this workbook — a first name only in Redwave's sample. Not split, unlike the statement. */
  customer_name: string;
  /** ONE string: "street, city, province, postal". */
  address: string | null;
  /** clients.client_code. */
  channel: string;
  /** The internet speed product on the sale ("Fibre 1gig/2.5gig"), or null when it has no internet. */
  product_name: string | null;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  is_greenfield: boolean;
  components: PayrollComponents;
}

export interface PayrollLine {
  sale_id: string;
  sort_order: number;
  sale_date: string;
  rep_external_code: string | null;
  rep_code: string;
  rep_name: string;
  customer_name: string;
  address: string | null;
  channel: string;
  product_name: string | null;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  is_greenfield: boolean;
  internet_rate: Decimal;
  tv_rate: Decimal;
  hp_rate: Decimal;
  greenfield: Decimal;
  spiff: Decimal;
  other_total: Decimal;
  /** The exact sum of the six components above (#1). */
  total_100: Decimal;
  advance_70: Decimal;
  holdback_30: Decimal;
}

export interface PayrollReport {
  lines: PayrollLine[];
  /** The row-1 SUBTOTAL strip — the three money columns ONLY. Redwave's payroll sheet has no COUNTIF. */
  total_100: Decimal;
  advance_70: Decimal;
  holdback_30: Decimal;
}

/** Exact 2-dp half-up — the house rounding rule, applied only where a split is derived. */
function roundHalfUp(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * The 70/30 split for one line. `advance` is rounded and `holdback` is DERIVED as the remainder, so the
 * two always sum to the total exactly and no cent is ever lost — the same derivation the engine uses for
 * the period-level split. Passing the pct in keeps this pure and config-driven (#10).
 */
function splitLine(total: Decimal, advancePct: Decimal): { advance: Decimal; holdback: Decimal } {
  const advance = roundHalfUp(total.times(advancePct));
  return { advance, holdback: total.minus(advance) };
}

/**
 * Assemble the report. Rows are ordered by (sale_date, sale_id) so a re-render is byte-identical — the
 * caller freezes `sort_order`, and a stable order is what makes the frozen line re-renderable (#2).
 */
export function buildPayrollReport(sales: PayrollSaleInput[], advancePct: Decimal): PayrollReport {
  const ordered = [...sales].sort(
    (a, b) => a.sale_date.localeCompare(b.sale_date) || a.sale_id.localeCompare(b.sale_id),
  );

  const lines: PayrollLine[] = ordered.map((sale, index) => {
    const c = sale.components;
    // The exact sum of every component, including `other`, so a priced item can never vanish from the
    // total just because the workbook has no column for it.
    const total = c.internet.plus(c.tv).plus(c.home_phone).plus(c.greenfield).plus(c.spiff).plus(c.other);
    const { advance, holdback } = splitLine(total, advancePct);
    return {
      sale_id: sale.sale_id,
      sort_order: index,
      sale_date: sale.sale_date,
      rep_external_code: sale.rep_external_code,
      rep_code: sale.rep_code,
      rep_name: sale.rep_name,
      customer_name: sale.customer_name,
      address: sale.address,
      channel: sale.channel,
      product_name: sale.product_name,
      has_internet: sale.has_internet,
      has_tv: sale.has_tv,
      has_home_phone: sale.has_home_phone,
      is_greenfield: sale.is_greenfield,
      internet_rate: c.internet,
      tv_rate: c.tv,
      hp_rate: c.home_phone,
      greenfield: c.greenfield,
      spiff: c.spiff,
      other_total: c.other,
      total_100: total,
      advance_70: advance,
      holdback_30: holdback,
    };
  });

  // The strip sums the LINES, so it always agrees with what is printed above it. Summing the components
  // again independently could disagree by a cent once each line's split has been rounded.
  const sum = (pick: (l: PayrollLine) => Decimal) => lines.reduce((acc, l) => acc.plus(pick(l)), ZERO);
  return {
    lines,
    total_100: sum((l) => l.total_100),
    advance_70: sum((l) => l.advance_70),
    holdback_30: sum((l) => l.holdback_30),
  };
}
