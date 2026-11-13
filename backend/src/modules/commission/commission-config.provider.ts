/**
 * CommissionConfigProvider — the ENGINE INPUT PROVIDER (closes the engine loop).
 *
 * Reads the effective-dated config stored by this module and returns the exact typed `EngineConfig`
 * the pure Commission Engine expects (engine.types.ts). This is the boundary where Prisma `Decimal`
 * is converted to decimal.js `Decimal` (`new Decimal(value.toString())`) — the engine stays pure and
 * Prisma-free (CLAUDE §6). Consumed later by Pay Run; not exposed over HTTP.
 *
 * This is the REP commission stream — it never reads/joins client_billing_rates (#3). No tiers and no split
 * since 2026-11-13: the config is the rep rates (by product type / product, global or per client) + incentives.
 */
import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { dateOnly, selectEffectiveRate } from '../../common/effective-dating';
import { GLOBAL_SCOPE, scopeKeyOf } from './client-scope.logic';
import {
  EngineConfig,
  FlatRates,
  IncentiveConfig,
  ProductType as EngineProductType,
} from '../engine/engine.types';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const toDecimal = (value: { toString(): string }): Decimal => new Decimal(value.toString());

@Injectable()
export class CommissionConfigProvider {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the engine config (rep rates + incentives) in force on `date` ('YYYY-MM-DD'). A sold type with no
   * rate is caught by the engine and surfaced by Pay Run as a 422.
   */
  async getEngineConfig(date: string): Promise<EngineConfig> {
    const on = dateOnly(date);

    // 1. Rates by product type — one effective row per (client scope, product_type), keyed by the catalogue
    // key. Built over whatever types are configured & effective on the date (NOT a hard-coded set), so
    // SA-added types are supported. A sold type missing from BOTH the client map and the global map throws
    // in the engine (surfaced as a 422 naming the type). Rep stream only (#3).
    // PARTITION FIRST: a row carrying a product_id prices ONE product and must never be mixed into the
    // product-TYPE maps, or the most specific rate would masquerade as the rate for the whole type.
    const allFlatRows = await this.prisma.commissionFlatRate.findMany();
    // `?? null` on purpose: treat a MISSING product_id exactly like an explicit null (a type-wide rate).
    // Anything else would misfile a row as product-specific and silently stop the type rate applying.
    const flatRows = allFlatRows.filter((r) => (r.product_id ?? null) === null);
    const flatProductRows = allFlatRows.filter((r) => (r.product_id ?? null) !== null);
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

    // 2. PER-PRODUCT rates — the most specific rate there is, resolved per (scope, product).
    const flatRatesByProduct: Record<string, Decimal> = {};
    const flatRatesByClientProduct: Record<string, Record<string, Decimal>> = {};
    const flatProductScopes = [...new Set(flatProductRows.map((r) => `${scopeKeyOf(r)}|${r.product_id}`))];
    for (const scopeKey of flatProductScopes) {
      const [scope, productId] = scopeKey.split('|');
      const effective = selectEffectiveRate(
        flatProductRows.filter((r) => scopeKeyOf(r) === scope && r.product_id === productId),
        on,
      );
      if (!effective) continue;
      const amount = toDecimal(effective.amount);
      if (scope === GLOBAL_SCOPE) {
        flatRatesByProduct[productId] = amount;
      } else {
        (flatRatesByClientProduct[scope] ??= {})[productId] = amount;
      }
    }

    // 3. Active incentives (the engine windows them per sale_date and applies both modes, threshold-relative).
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

    return { flatRates, flatRatesByClient, flatRatesByProduct, flatRatesByClientProduct, incentives };
  }
}
