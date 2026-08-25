
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
