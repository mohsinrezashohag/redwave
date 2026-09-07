/**
 * Central money policy — the SINGLE rounding/formatting authority for every presentation + export path
 * (statements, invoices, QuickBooks CSV, reconciliation). The rule: keep EXACT decimal in storage and
 * arithmetic; round to 2 dp HALF_UP ONLY at the presentation boundary. This half-up rule is also the ONE
 * used to compute a frozen `amount_cad` (see `common/fx`). — BRD §8.2, CLAUDE §1
 *
 * Multi-currency with a frozen FX snapshot (Meeting 3, #12): documents bill in a client's currency and
 * roll up to CAD via a rate captured once at issue/approval. **CAD is the reconciliation/base currency** —
 * every CAD roll-up reads the frozen `amount_cad`; the original currency + rate are retained for audit.
 *
 * (The isolated Commission Engine carries its own identical `roundMoneyHalfUp` to preserve its
 * zero-dependency purity — §6; it is the SAME rule, a different stream — #3.)
 */
import { Decimal } from 'decimal.js';

/** Decimal places + rounding mode for ALL money. */
export const MONEY_DP = 2;
export const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;

/** The reconciliation/base currency for CAD roll-ups (documents may bill in another currency, #12). */
export const CURRENCY = 'CAD';

export const ZERO = new Decimal(0);

/** Coerce a string/number/Decimal to a Decimal (prefer string literals for money). */
export const toMoney = (value: Decimal.Value): Decimal => new Decimal(value);

/** THE rounding policy: 2 dp, HALF_UP. */
export function roundMoneyHalfUp(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);
}

/** Canonical serialised form — a fixed 2-dp string ('1234.50') used in API responses + persisted columns. */
export function formatMoney(value: Decimal.Value): string {
  return roundMoneyHalfUp(value).toFixed(MONEY_DP);
}

/** Exact sum (empty → 0); rounding is the caller's choice at the boundary. */
export function sumMoney(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(new Decimal(v)), ZERO);
}
