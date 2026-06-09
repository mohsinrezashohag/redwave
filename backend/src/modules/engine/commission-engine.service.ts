/**
 * CommissionEngineService — the PURE, deterministic, config-driven commission calculator.
 *
 * Responsibility: given a rep's activations for a period + the effective configuration, return the
 * tier, per-item amounts, gross commission, the 70/30 split, and (separately) incentives. Also a
 * pure clawback-amount calculation from a frozen snapshot.
 *
 * Isolation: NO database, NO HTTP, NO other module, NO @prisma/client. No constructor dependencies.
 * Same inputs → same outputs, always. — CLAUDE §3 (#1,#5,#6,#9), §6, arch §8
 *
 * Owns no entities (it persists nothing). Whoever calls it passes inputs and consumes outputs.
 */
import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  ActivationInput,
  ClawbackSnapshot,
  ComputedItem,
  EngineConfig,
  IncentiveConfig,
  PeriodInput,
  PeriodResult,
  ProductType,
  TierBracket,
} from './engine.types';
import { roundMoneyHalfUp, sum, ZERO } from './money';

@Injectable()
export class CommissionEngineService {
  /**
   * Compute a full period result for one rep.
   * Gross tally never re-tiers; tier is from the gross internet count across ALL clients and is
   * applied to every internet activation. — CLAUDE #5, SRS PAY-002 / §8.2
   */
  computePeriod(input: PeriodInput): PeriodResult {
    const { activations, config } = input;

    // Tier from the GROSS internet tally (non-greenfield internet), aggregated across all clients.
    const internetTally = activations.filter((a) => a.productType === ProductType.internet).length;
    const tierBracket = internetTally > 0 ? this.determineTier(internetTally, config.tiers) : null;

    const items = activations.map((activation) =>
      this.computeItem(activation, config, tierBracket),
    );

    const grossCommission = sum(items.map((i) => i.commissionBase)); // 70/30 base — tier+flat only
    const incentiveTotal = sum(items.map((i) => i.incentiveAmount)); // separate, paid in full

    // 70/30 split: round the advance to cents (HALF_UP), derive holdback so the two sum to gross
    // exactly (never lose a cent). — CLAUDE #1, SRS PAY-003 / NFR-001
    const advanceAmount = roundMoneyHalfUp(grossCommission.times(config.holdback.advancePct));
    const holdbackAmount = grossCommission.minus(advanceAmount);

    return {
      internetTally,
      tierNumber: tierBracket?.tierNumber ?? null,
      ratePerActivation: tierBracket?.ratePerActivation ?? null,
      items,
      grossCommission,
      advanceAmount,
      holdbackAmount,
      incentiveTotal,
      totalEarned: grossCommission.plus(incentiveTotal),
    };
  }

  /**
   * The clawback recovery for a single cancelled item: the exact amount originally paid
   * (rate + any incentive), read from the snapshot. No date math, no re-tier, no effect on other
   * items. — CLAUDE #4/#6, SRS CLAW-001/003/004/005
   */
  computeClawbackAmount(snapshot: ClawbackSnapshot): Decimal {
    return snapshot.rateApplied.plus(snapshot.incentiveAmount ?? ZERO);
  }

  /**
   * Select the tier bracket whose [minCount, maxCount] contains the tally. Exactly one must match;
   * a tally that matches none indicates a misconfigured schedule (fail loudly rather than mis-pay).
   */
  determineTier(tally: number, tiers: TierBracket[]): TierBracket {
    const bracket = tiers.find(
      (t) => tally >= t.minCount && (t.maxCount === null || tally <= t.maxCount),
    );
    if (!bracket) {
      throw new Error(`No tier bracket matches an internet tally of ${tally}`);
    }
    return bracket;
  }

  /** Compute one activation's amounts (tier rate or flat rate, plus any per_activation incentive). */
  private computeItem(
    activation: ActivationInput,
    config: EngineConfig,
    tierBracket: TierBracket | null,
  ): ComputedItem {
    const isInternet = activation.productType === ProductType.internet;

    // Base rate: tiered for internet, flat for everything else. Greenfield is flat AND tally-excluded.
    let rateApplied: Decimal;
    let tierAtPayment: number | null;
    if (isInternet) {
      // tierBracket is non-null whenever an internet activation exists (tally > 0).
      if (!tierBracket) {
        throw new Error('Internal: internet activation with no tier bracket');
      }
      rateApplied = tierBracket.ratePerActivation;
      tierAtPayment = tierBracket.tierNumber;
    } else {
      rateApplied = this.flatRateFor(activation.productType, config.flatRates);
      tierAtPayment = null;
    }

    const { incentiveId, incentiveAmount } = this.resolveIncentive(activation, config.incentives);

    return {
      id: activation.id,
      productType: activation.productType,
      countsTowardTally: isInternet, // only non-greenfield internet counts — CLAUDE #9
      tierAtPayment,
      rateApplied,
      commissionBase: rateApplied,
      incentiveId,
      incentiveAmount,
      commissionPaid: rateApplied.plus(incentiveAmount), // snapshot value == clawback amount
    };
  }

  private flatRateFor(productType: string, flatRates: EngineConfig['flatRates']): Decimal {
    // internet is handled by the tier path; every other (flat) type is a map lookup by key.
    const rate = flatRates[productType];
    if (rate === undefined) {
      throw new Error(`No flat rate for product type ${productType}`);
    }
    return rate;
  }

  /**
   * Sum every per_activation incentive that matches this activation (scope + sale_date window).
   * `target_based` incentives are NOT computed this pass (deferred — see CLAUDE §12). — SRS COMM-005
   */
  private resolveIncentive(
    activation: ActivationInput,
    incentives: IncentiveConfig[] | undefined,
  ): { incentiveId: string | null; incentiveAmount: Decimal } {
    if (!incentives?.length) {
      return { incentiveId: null, incentiveAmount: ZERO };
    }
    let incentiveId: string | null = null;
    let incentiveAmount = ZERO;
    for (const incentive of incentives) {
      if (this.incentiveApplies(activation, incentive)) {
        incentiveAmount = incentiveAmount.plus(incentive.amount);
        if (incentiveId === null) {
          incentiveId = incentive.id; // record the first matching incentive
        }
      }
    }
    return { incentiveId, incentiveAmount };
  }

  private incentiveApplies(activation: ActivationInput, incentive: IncentiveConfig): boolean {
    if (incentive.targetType !== 'per_activation') {
      return false; // target_based deferred
    }
    if (incentive.scopeClientId !== null && incentive.scopeClientId !== activation.clientId) {
      return false;
    }
    if (
      incentive.scopeProductType !== null &&
      incentive.scopeProductType !== activation.productType
    ) {
      return false;
    }
    // ISO 'YYYY-MM-DD' strings compare lexicographically — inclusive window.
    return (
      activation.saleDate >= incentive.windowStart && activation.saleDate <= incentive.windowEnd
    );
  }
}
