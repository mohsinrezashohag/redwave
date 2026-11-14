/**
 * CommissionEngineService — the PURE, deterministic, config-driven commission calculator.
 *
 * Responsibility: given a rep's activations for a period + the effective configuration, return each item's
 * rep rate, the commission total and (separately) incentives. Also a pure clawback-amount calculation from a
 * frozen snapshot.
 *
 * Client decision 2026-11-13: NO tiers and NO 70/30 split. Every item pays one flat rep rate and the rep is
 * paid in full; Redwave applies any tier or split manually, outside the system, from its exports.
 *
 * Isolation: NO database, NO HTTP, NO other module, NO @prisma/client. No constructor dependencies.
 * Same inputs → same outputs, always. — CLAUDE §3 (#1,#6), §6, arch §8
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
} from './engine.types';
import { sum, ZERO } from './money';

@Injectable()
export class CommissionEngineService {
  /** Compute a full period result for one rep: each item's rate, plus incentives. */
  computePeriod(input: PeriodInput): PeriodResult {
    const { activations, config } = input;
    const items = activations.map((activation) => this.computeItem(activation, config));
    // Incentives are applied in a PERIOD-LEVEL pass (a threshold is relative to the rep's matching
    // activations for that incentive), then frozen onto the relevant items. — SRS COMM-005
    this.applyIncentives(items, activations, config.incentives);

    const commissionTotal = sum(items.map((i) => i.commissionBase));
    const incentiveTotal = sum(items.map((i) => i.incentiveAmount));
    return { items, commissionTotal, incentiveTotal, totalEarned: commissionTotal.plus(incentiveTotal) };
  }

  /**
   * The clawback recovery for a single cancelled item: the exact amount originally paid (rate + any
   * incentive), read from the snapshot. No date math, no effect on other items. — CLAUDE #4/#6, SRS CLAW-001..005
   */
  computeClawbackAmount(snapshot: ClawbackSnapshot): Decimal {
    return snapshot.rateApplied.plus(snapshot.incentiveAmount ?? ZERO);
  }

  /** Compute one activation's amounts (its flat rep rate; incentives are added by the period pass). */
  private computeItem(activation: ActivationInput, config: EngineConfig): ComputedItem {
    const rateApplied = this.rateFor(activation, config);
    return {
      id: activation.id,
      productType: activation.productType,
      rateApplied,
      commissionBase: rateApplied,
      incentiveId: null, // filled by the period-level incentive pass
      incentiveAmount: ZERO,
      commissionPaid: rateApplied, // snapshot value (base + incentive once the pass runs)
    };
  }

  /**
   * The rep rate for one item. Most specific wins: (client + product) → (product) → (client + type) → (type).
   * A GREENFIELD internet sale skips the product steps: it keeps the internet product's id (for billing and
   * reporting) but is paid the greenfield rate, never that product's own internet rate.
   */
  private rateFor(activation: ActivationInput, config: EngineConfig): Decimal {
    const rate = this.lookupRate(activation, config);
    if (rate === undefined) {
      throw new Error(`No rep rate for product type ${activation.productType} (client ${activation.clientId})`);
    }
    return rate;
  }

  /**
   * The rep rate in force for one item, or null when none is configured. The SAME resolution the pay run
   * uses (most specific wins, greenfield skips the product steps), exposed so a read can show the rate a
   * sale WILL be paid before it is frozen. Never writes anything. — CLAUDE #5/#9
   */
  rateInForce(activation: ActivationInput, config: EngineConfig): Decimal | null {
    return this.lookupRate(activation, config) ?? null;
  }

  private lookupRate(activation: ActivationInput, config: EngineConfig): Decimal | undefined {
    const { productType, clientId } = activation;
    const productId = productType === ProductType.greenfield_internet ? null : activation.productId;
    const rate =
      (productId ? config.flatRatesByClientProduct?.[clientId]?.[productId] : undefined) ??
      (productId ? config.flatRatesByProduct?.[productId] : undefined) ??
      config.flatRatesByClient?.[clientId]?.[productType] ??
      config.flatRates[productType];
    return rate;
  }

  /**
   * Apply every active incentive across the period (a threshold is relative to the rep's matching
   * activations), freezing the bonus onto the relevant items. Both modes:
   *   • per_activation — bonus on each matching activation BEYOND `targetCount` (null/0 = all).
   *   • one_time      — one bonus once the rep reaches `targetCount` matching activations (the crossing one).
   * Incentive money is kept separate from the rate (commissionBase is never touched). — SRS COMM-005
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
