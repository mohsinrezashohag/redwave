/**
 * CommissionConfigProvider — the ENGINE INPUT PROVIDER (closes the engine loop).
 *
 * Reads the effective-dated config stored by this module and returns the exact typed `EngineConfig`
 * the pure Commission Engine expects (engine.types.ts). This is the boundary where Prisma `Decimal`
 * is converted to decimal.js `Decimal` (`new Decimal(value.toString())`) — the engine stays pure and
 * Prisma-free (CLAUDE §6). Consumed later by Pay Run; not exposed over HTTP.
 *
 * This is the REP commission stream — it never reads/joins client_billing_rates (#3).
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { dateOnly, selectEffectiveRate } from '../../common/effective-dating';
import {
  EngineConfig,
  FlatRates,
  IncentiveConfig,
  ProductType as EngineProductType,
  TierBracket,
} from '../engine/engine.types';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const toDecimal = (value: { toString(): string }): Decimal => new Decimal(value.toString());

@Injectable()
export class CommissionConfigProvider {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the engine config in force on `date` ('YYYY-MM-DD'). Throws 422 if a required piece of
   * config (tier schedule, any flat rate, holdback split) is missing for the date.
   */
  async getEngineConfig(date: string): Promise<EngineConfig> {
    const on = dateOnly(date);

    // 1. Tier schedule (header in force + its bracket rows).
    const headers = await this.prisma.commissionTierConfig.findMany({ include: { tiers: true } });
    const header = selectEffectiveRate(headers, on);
    if (!header) {
      throw new UnprocessableEntityException(`no effective tier schedule on ${date}`);
    }
    const tiers: TierBracket[] = header.tiers.map((t) => ({
      tierNumber: t.tier_number,
      minCount: t.min_count,
      maxCount: t.max_count,
      ratePerActivation: toDecimal(t.rate_per_activation),
    }));

    // 2. Flat rates — one effective row per product_type, as a map keyed by the catalogue key. Built over
    // whatever flat types are configured & effective on the date (NOT a hard-coded trio), so SA-added types
    // are supported. A sold type missing from this map throws in the engine (the inline-rate-at-creation
    // flow makes that an edge). The engine determines tiers — flat rates here are pay rates only (#3/#5).
    const flatRows = await this.prisma.commissionFlatRate.findMany();
    const flatTypes = [...new Set(flatRows.map((r) => r.product_type))];
    const flatRates: FlatRates = {};
    for (const productType of flatTypes) {
      const effective = selectEffectiveRate(
        flatRows.filter((r) => r.product_type === productType),
        on,
      );
      if (effective) {
        flatRates[productType] = toDecimal(effective.amount);
      }
    }

    // 3. Holdback split.
    const holdbackRows = await this.prisma.holdbackConfig.findMany();
    const holdbackRow = selectEffectiveRate(holdbackRows, on);
    if (!holdbackRow) {
      throw new UnprocessableEntityException(`no effective holdback split on ${date}`);
    }
    const holdback = {
      advancePct: toDecimal(holdbackRow.advance_pct),
      holdbackPct: toDecimal(holdbackRow.holdback_pct),
    };

    // 4. Active incentives (the engine windows them per sale_date and ignores target_based).
    const incentiveRows = await this.prisma.incentive.findMany({ where: { status: 'active' } });
    const incentives: IncentiveConfig[] = incentiveRows.map((i) => ({
      id: i.id,
      scopeClientId: i.scope_client_id,
      scopeProductType: (i.scope_product_type as unknown as EngineProductType) ?? null,
      targetType: i.target_type,
      targetCount: i.target_count,
      windowStart: isoDate(i.window_start),
      windowEnd: isoDate(i.window_end),
      amount: toDecimal(i.amount),
    }));

    return { tiers, flatRates, holdback, incentives };
  }
}
