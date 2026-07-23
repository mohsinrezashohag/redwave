/**
 * Pure pay-run-line arithmetic — exact decimal, never float (#1). Composes the engine result with
 * the released holdback, expenses, bonus, and clawbacks into the line totals. — SRS §9.2, arch §9
 *
 * net = 70% advance + released 30% + approved expenses + incentives (paid in full) + bonus − clawbacks.
 * The 30% HELD this period (engine holdbackAmount) is recorded on the holdback ledger, not paid here.
 */
import { Decimal } from 'decimal.js';
import { PeriodResult } from '../engine/engine.types';

export interface LineInputs {
  released: Decimal; // 30% released from prior origin periods, due now
  expense: Decimal; // approved expenses (seam — 0 until Expenses exists)
  bonus: Decimal; // ad-hoc Super Admin bonus
  clawback: Decimal; // flat clawback deductions (seam — 0 until Clawback exists)
}

export interface LineAmounts {
  commission_70: Decimal; // engine advance (70% of gross)
  amount_held: Decimal; // engine holdback (30%) → holdback_ledger.amount_held
  holdback_release_30: Decimal;
  incentive_total: Decimal;
  expense_total: Decimal;
  bonus_amount: Decimal;
  clawback_total: Decimal;
  net_payout: Decimal;
  // ── Reconciliation facts — copied VERBATIM off the engine result, never derived here (#1/#5). They let
  // the UI prove the split (gross = commission_70 + amount_held) and how gross was reached (tier × tally).
  gross_commission: Decimal; // the 70/30 base — Σ commissionBase, EXCLUDES incentives (paid in full)
  tier_at_payment: number | null; // null when the internet tally is 0
  internet_tally: number; // gross non-greenfield internet count across ALL clients (#5)
  rate_per_activation: Decimal | null; // null when there is no tier
}

export function computeNet(parts: {
  advance: Decimal;
  released: Decimal;
  expense: Decimal;
  incentive: Decimal;
  bonus: Decimal;
  clawback: Decimal;
}): Decimal {
  return parts.advance
    .plus(parts.released)
    .plus(parts.expense)
    .plus(parts.incentive)
    .plus(parts.bonus)
    .minus(parts.clawback);
}

export function buildLineAmounts(result: PeriodResult, inputs: LineInputs): LineAmounts {
  return {
    commission_70: result.advanceAmount,
    amount_held: result.holdbackAmount,
    holdback_release_30: inputs.released,
    incentive_total: result.incentiveTotal,
    expense_total: inputs.expense,
    bonus_amount: inputs.bonus,
    clawback_total: inputs.clawback,
    net_payout: computeNet({
      advance: result.advanceAmount,
      released: inputs.released,
      expense: inputs.expense,
      incentive: result.incentiveTotal,
      bonus: inputs.bonus,
      clawback: inputs.clawback,
    }),
    // Pass-through only — the engine is the sole author of these (#5).
    gross_commission: result.grossCommission,
    tier_at_payment: result.tierNumber,
    internet_tally: result.internetTally,
    rate_per_activation: result.ratePerActivation,
  };
}
