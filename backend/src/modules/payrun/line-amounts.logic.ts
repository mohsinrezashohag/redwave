/**
 * Pure pay-run-line arithmetic — exact decimal, never float (#1). Composes the engine result with expenses,
 * bonus and clawbacks into the line totals. — SRS §9.2, arch §9
 *
 * net = commission (paid in full) + approved expenses + incentives (paid in full) + bonus − clawbacks.
 * No tiers and no 70/30 since 2026-11-13: nothing is held, nothing is released.
 */
import { Decimal } from 'decimal.js';
import { PeriodResult } from '../engine/engine.types';

export interface LineInputs {
  expense: Decimal; // approved expenses (seam)
  bonus: Decimal; // ad-hoc Super Admin bonus
  clawback: Decimal; // flat clawback deductions (seam)
}

export interface LineAmounts {
  commission: Decimal; // Σ item rates — paid in full
  incentive_total: Decimal;
  expense_total: Decimal;
  bonus_amount: Decimal;
  clawback_total: Decimal;
  net_payout: Decimal;
}

export function computeNet(parts: {
  commission: Decimal;
  expense: Decimal;
  incentive: Decimal;
  bonus: Decimal;
  clawback: Decimal;
}): Decimal {
  return parts.commission.plus(parts.expense).plus(parts.incentive).plus(parts.bonus).minus(parts.clawback);
}

export function buildLineAmounts(result: PeriodResult, inputs: LineInputs): LineAmounts {
  return {
    commission: result.commissionTotal,
    incentive_total: result.incentiveTotal,
    expense_total: inputs.expense,
    bonus_amount: inputs.bonus,
    clawback_total: inputs.clawback,
    net_payout: computeNet({
      commission: result.commissionTotal,
      expense: inputs.expense,
      incentive: result.incentiveTotal,
      bonus: inputs.bonus,
      clawback: inputs.clawback,
    }),
  };
}
