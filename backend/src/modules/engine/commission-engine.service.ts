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
    // ⚠ NEVER add a clientId predicate here. Per-client SCHEDULES change which rate an activation is paid
    // at; they never split the tally — counting per client is the explicit forbidden mistake. — CLAUDE #5
    const internetTally = activations.filter((a) => a.productType === ProductType.internet).length;

    // The bracket is resolved PER CLIENT (that client's ladder, else the global one) but always against the
    // ONE cross-client tally above — memoised so a schedule is walked once per client, not once per item.
    const bracketCache = new Map<string, TierBracket>();
    const bracketFor = (clientId: string): TierBracket => {
      const cached = bracketCache.get(clientId);
      if (cached) return cached;
      const ladder = config.tiersByClient?.[clientId] ?? config.tiers;
      const bracket = this.determineTier(internetTally, ladder);
      bracketCache.set(clientId, bracket);
      return bracket;
    };

    const items = activations.map((activation) =>
      this.computeItem(activation, config, internetTally > 0 ? bracketFor : null),
    );
    // Incentives are applied in a PERIOD-LEVEL pass (a threshold is relative to the rep's matching
    // activations for that incentive), then frozen onto the relevant items. — SRS COMM-005
    this.applyIncentives(items, activations, config.incentives);

    const grossCommission = sum(items.map((i) => i.commissionBase)); // 70/30 base — tier+flat only
    const incentiveTotal = sum(items.map((i) => i.incentiveAmount)); // separate, paid in full

    // 70/30 split: round the advance to cents (HALF_UP), derive holdback so the two sum to gross
    // exactly (never lose a cent). — CLAUDE #1, SRS PAY-003 / NFR-001
    const advanceAmount = roundMoneyHalfUp(grossCommission.times(config.holdback.advancePct));
    const holdbackAmount = grossCommission.minus(advanceAmount);

    // Period-level tier/rate are only meaningful when every internet activation resolved to the SAME
    // bracket; with per-client schedules a mixed period has no single answer, so report null and let the
    // per-item snapshots carry the truth.
    const internetItems = items.filter((i) => i.countsTowardTally);
    const uniformTier = this.uniformTier(internetItems);

    return {
      internetTally,
      tierNumber: uniformTier?.tierAtPayment ?? null,
      ratePerActivation: uniformTier?.rateApplied ?? null,
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

  /**
   * The bracket shared by every internet item, or null when they differ (per-client schedules) or there
   * are none. Compares the resolved tier + rate, which is what the period-level scalars report.
   */
  private uniformTier(internetItems: ComputedItem[]): ComputedItem | null {
    const first = internetItems[0];
    if (!first) return null;
    const mixed = internetItems.some(
      (i) => i.tierAtPayment !== first.tierAtPayment || !i.rateApplied.equals(first.rateApplied),
    );
    return mixed ? null : first;
  }

  /** Compute one activation's amounts (tier rate or flat rate, plus any per_activation incentive). */
  private computeItem(
    activation: ActivationInput,
    config: EngineConfig,
    bracketFor: ((clientId: string) => TierBracket) | null,
  ): ComputedItem {
    const isInternet = activation.productType === ProductType.internet;

    // Base rate: tiered for internet, flat for everything else. Greenfield is flat AND tally-excluded.
    let rateApplied: Decimal;
    let tierAtPayment: number | null;
    if (isInternet) {
      // bracketFor is non-null whenever an internet activation exists (tally > 0).
      if (!bracketFor) {
        throw new Error('Internal: internet activation with no tier bracket');
      }
      // This client's ladder (else the global one), against the ONE cross-client tally.
      const bracket = bracketFor(activation.clientId);
      rateApplied = bracket.ratePerActivation;
      tierAtPayment = bracket.tierNumber;
    } else {
      rateApplied = this.flatRateFor(activation.productType, activation.clientId, config);
      tierAtPayment = null;
    }

    return {
      id: activation.id,
      productType: activation.productType,
      countsTowardTally: isInternet, // only non-greenfield internet counts — CLAUDE #9
      tierAtPayment,
      rateApplied,
      commissionBase: rateApplied,
      incentiveId: null, // filled by the period-level incentive pass
      incentiveAmount: ZERO,
      commissionPaid: rateApplied, // snapshot value (base + incentive once the pass runs)
    };
  }

  private flatRateFor(productType: string, clientId: string, config: EngineConfig): Decimal {
    // internet is handled by the tier path; every other (flat) type is a map lookup by key — this client's
    // own rate first, then the global one.
    const rate = config.flatRatesByClient?.[clientId]?.[productType] ?? config.flatRates[productType];
    if (rate === undefined) {
      throw new Error(`No flat rate for product type ${productType} (client ${clientId})`);
    }
    return rate;
  }

  /**
   * Apply every active incentive across the period (a threshold is relative to the rep's matching
   * activations), freezing the bonus onto the relevant items. Both modes:
   *   • per_activation — bonus on each matching activation BEYOND `targetCount` (null/0 = all).
   *   • one_time      — one bonus once the rep reaches `targetCount` matching activations (the crossing one).
   * Incentive money is SEPARATE from the 70/30 base (commissionBase is never touched). — SRS COMM-005
   */
  private applyIncentives(
    items: ComputedItem[],
    activations: ActivationInput[],
    incentives: IncentiveConfig[] | undefined,
  ): void {
    if (!incentives?.length) {
      return;
    }
    const byId = new Map(items.map((it) => [it.id, it]));
    for (const incentive of incentives) {
      // Matching activations, ordered deterministically (sale_date, then id) so "the Nth" is stable.
      const matched = activations
        .filter((a) => this.incentiveMatches(a, incentive))
        .sort((x, y) => (x.saleDate === y.saleDate ? x.id.localeCompare(y.id) : x.saleDate.localeCompare(y.saleDate)));
      if (matched.length === 0) {
        continue;
      }
      if (incentive.targetType === 'per_activation') {
        const threshold = incentive.targetCount ?? 0; // pay on activations BEYOND the threshold (0 = all)
        for (let i = threshold; i < matched.length; i++) {
          this.addIncentive(byId.get(matched[i].id), incentive);
        }
      } else {
        // one_time: a single bonus once the rep reaches `targetCount` matching activations.
        const n = incentive.targetCount ?? 1;
        if (matched.length >= n) {
          this.addIncentive(byId.get(matched[n - 1].id), incentive); // the threshold-crossing activation
        }
      }
    }
  }

  /** Add an incentive's amount to an item's snapshot (sum amounts; record the first incentive id). */
  private addIncentive(item: ComputedItem | undefined, incentive: IncentiveConfig): void {
    if (!item) {
      return;
    }
    item.incentiveAmount = item.incentiveAmount.plus(incentive.amount);
    if (item.incentiveId === null) {
      item.incentiveId = incentive.id;
    }
    item.commissionPaid = item.commissionBase.plus(item.incentiveAmount); // snapshot == clawback amount
  }

  /** Scope (client/product) + inclusive sale_date window match — independent of the target mode. */
  private incentiveMatches(activation: ActivationInput, incentive: IncentiveConfig): boolean {
    if (incentive.scopeClientId !== null && incentive.scopeClientId !== activation.clientId) {
      return false;
    }
    if (incentive.scopeProductType !== null && incentive.scopeProductType !== activation.productType) {
      return false;
    }
    // ISO 'YYYY-MM-DD' strings compare lexicographically — inclusive window.
    return activation.saleDate >= incentive.windowStart && activation.saleDate <= incentive.windowEnd;
  }
}
