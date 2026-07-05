/**
 * FX conversion — PURE & deterministic (no I/O). Convert an amount in a foreign currency to CAD using a
 * FROZEN rate. Rounds to 2 dp HALF_UP via the central money policy — this is the ONLY place a converted
 * CAD figure is computed, so the house rounding rule is applied identically at every capture point (rep
 * expense at approval, client bill at issue). The rate itself is high-precision and stored verbatim; only
 * the resulting CAD amount is rounded. — CLAUDE §3 #12 / §1
 */
import { Decimal } from 'decimal.js';
import { roundMoneyHalfUp } from '../money/money';

/** `amount` (in original currency) × `fxRate` → CAD, rounded 2 dp HALF_UP. */
export function convertToCad(amount: Decimal.Value, fxRate: Decimal.Value): Decimal {
  return roundMoneyHalfUp(new Decimal(amount).times(new Decimal(fxRate)));
}
