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
import { GLOBAL_SCOPE, scopeKeyOf, selectEffectiveByScope } from './client-scope.logic';
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

    // 1. Tier schedules — the GLOBAL ladder plus any per-client ones.
    // MUST group by client scope BEFORE picking the effective row: selectEffectiveRate returns the latest
    // effective_from from whatever array it is given, so a mixed-scope list would let one client's newer
    // schedule masquerade as everyone's.
    const headers = await this.prisma.commissionTierConfig.findMany({ include: { tiers: true } });
    const effectiveHeaders = selectEffectiveByScope(headers, on);
    const globalHeader = effectiveHeaders.get(GLOBAL_SCOPE);
    if (!globalHeader) {
      throw new UnprocessableEntityException(`no effective tier schedule on ${date}`);
    }
    const toBrackets = (rows: { tier_number: number; min_count: number; max_count: number | null; rate_per_activation: { toString(): string } }[]): TierBracket[] =>
      rows.map((t) => ({
        tierNumber: t.tier_number,
        minCount: t.min_count,
        maxCount: t.max_count,
        ratePerActivation: toDecimal(t.rate_per_activation),
      }));
    const tiers = toBrackets(globalHeader.tiers);
    const tiersByClient: Record<string, TierBracket[]> = {};
    for (const [scope, header] of effectiveHeaders) {
      if (scope !== GLOBAL_SCOPE) {
        tiersByClient[scope] = toBrackets(header.tiers);
      }
    }

    // 2. Flat rates — one effective row per (client scope, product_type), as maps keyed by the catalogue
    // key. Built over whatever flat types are configured & effective on the date (NOT a hard-coded trio),
    // so SA-added types are supported. A sold type missing from BOTH the client map and the global map
    // throws in the engine. The engine determines tiers — flat rates here are pay rates only (#3/#5).
    const flatRows = await this.prisma.commissionFlatRate.findMany();
    const flatRates: FlatRates = {};
    const flatRatesByClient: Record<string, FlatRates> = {};
    const flatScopes = [...new Set(flatRows.map((r) => `${scopeKeyOf(r)}|${r.product_type}`))];
    for (const scopeKey of flatScopes) {
      const [scope, productType] = scopeKey.split('|');
      const effective = selectEffectiveRate(
        flatRows.filter((r) => scopeKeyOf(r) === scope && r.product_type === productType),
        on,
      );
      if (!effective) continue;
      const amount = toDecimal(effective.amount);
      if (scope === GLOBAL_SCOPE) {
        flatRates[productType] = amount;
      } else {
        (flatRatesByClient[scope] ??= {})[productType] = amount;
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

    // 4. Active incentives (the engine windows them per sale_date and applies both modes, threshold-relative).
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

    return { tiers, flatRates, tiersByClient, flatRatesByClient, holdback, incentives };
  }
}
