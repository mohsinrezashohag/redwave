/**
 * BasePricesService — switch one scope (Global or one client) to BASE PRICES: no tier ladder; every internet
 * activation pays its product's own price, else the scope's default. — client request 2026-11-11
 *
 * Built ON today's model, so pay calculation is unchanged and reversible:
 *   - the scope's tier schedule becomes ONE bracket [0, ∞) = tier 1 at `default_rate`;
 *   - each priced product gets a tier-1 per-product rate (`commission_tier_rates`), which the engine already
 *     prefers over the bracket rate (client+product → product → bracket).
 * The tally is untouched (#5), and greenfield / TV / HP / add-ons stay flat rates (#9).
 *
 * All of it is ONE transaction: a bad product rolls the whole switch back, never half a price list. Every
 * row follows the shared effective-dating (#10): future-dated, superseding the scope's pending row and
 * bounding its current one; back-dating → 422; past rows are never touched.
 *
 * GLOBAL accepts a default price only. A global per-product price (client_id null) would override every
 * client's ladder for that product, including a client that keeps its own tiers.
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { deriveStatus, planSupersession } from '../../common/effective-dating';
import { parseEffectiveWindow } from './effective-dates.util';
import { resolveClientScope } from './client-scope.util';
import { planEndRows } from './base-prices.logic';
import { SetBasePricesDto } from './dto/base-prices.dto';

/** The bracket every base-price schedule has: tier 1, every count. */
export const BASE_TIER = 1;

@Injectable()
export class BasePricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async setBasePrices(dto: SetBasePricesDto, actorId: string) {
    const { from, to, today } = parseEffectiveWindow(dto.effective_from, dto.effective_to);
    const clientId = await resolveClientScope(this.prisma, dto.client_id);

    if (clientId === null && dto.prices.length > 0) {
      throw new UnprocessableEntityException(
        'The global setting takes a default price only. Set per-product prices on each client.',
      );
    }
    const ids = dto.prices.map((p) => p.product_id);
    if (new Set(ids).size !== ids.length) {
      throw new UnprocessableEntityException('a product is listed more than once');
    }
    // Every priced product must be a TIERED product of THIS client — anything else would sit in the config
    // looking set and never pay (the same "looks configured, pays nothing" guard as TierRateService).
    if (ids.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, client_id: true, product_type_ref: { select: { behaviour: true } } },
      });
      for (const id of ids) {
        const p = products.find((x) => x.id === id);
        if (!p) throw new UnprocessableEntityException(`Unknown product '${id}'`);
        if (p.client_id !== clientId) {
          throw new UnprocessableEntityException(`'${p.name}' belongs to another client`);
        }
        if (p.product_type_ref.behaviour !== 'tiered') {
          throw new UnprocessableEntityException(
            `'${p.name}' is not an internet product. Greenfield, TV, home phone and add-ons are priced under Flat rates.`,
          );
        }
      }
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        // 1. The schedule: one bracket at the default price, superseding the scope's own stream only.
        const schedules = await tx.commissionTierConfig.findMany({
          where: { client_id: clientId },
          select: { id: true, effective_from: true, effective_to: true },
        });
        const sPlan = planSupersession(schedules, from, today);
        if (sPlan.deletePendingIds.length > 0) {
          await tx.commissionTier.deleteMany({ where: { tier_config_id: { in: sPlan.deletePendingIds } } });
          await tx.commissionTierConfig.deleteMany({ where: { id: { in: sPlan.deletePendingIds } } });
        }
        if (sPlan.boundCurrent) {
          await tx.commissionTierConfig.update({
            where: { id: sPlan.boundCurrent.id },
            data: { effective_to: sPlan.boundCurrent.effectiveTo },
          });
        }
        const schedule = await tx.commissionTierConfig.create({
          data: {
            client_id: clientId,
            effective_from: from,
            effective_to: to,
            created_by: actorId,
            tiers: {
              create: [{ tier_number: BASE_TIER, min_count: 0, max_count: null, rate_per_activation: dto.default_rate }],
            },
          },
          include: { tiers: true },
        });

        // 2. Each product's own price (tier 1).
        const rates = [];
        for (const price of dto.prices) {
          const existing = await tx.commissionTierRate.findMany({
            where: { client_id: clientId, product_id: price.product_id, tier_number: BASE_TIER },
            select: { id: true, effective_from: true, effective_to: true },
          });
          const plan = planSupersession(existing, from, today);
          if (plan.deletePendingIds.length > 0) {
            await tx.commissionTierRate.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
          }
          if (plan.boundCurrent) {
            await tx.commissionTierRate.update({
              where: { id: plan.boundCurrent.id },
              data: { effective_to: plan.boundCurrent.effectiveTo },
            });
          }
          rates.push(
            await tx.commissionTierRate.create({
              data: {
                client_id: clientId,
                product_id: price.product_id,
                tier_number: BASE_TIER,
                amount: price.amount, // decimal STRING → Prisma Decimal (#1)
                effective_from: from,
                effective_to: to,
                created_by: actorId,
              },
            }),
          );
        }

        // 3. A product of this scope that had its own tier-1 price but is now left on the default: end that
        //    price from `from`, or it would keep overriding the default the admin just set.
        const ended = await endTierRatesWithinTx(tx, clientId, from, { excludeProductIds: ids });
        return { schedule, rates, ended };
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      actorId,
      entityType: 'commission_tier_configs',
      entityId: result.schedule.id,
      action: 'set_base_prices',
      after: {
        client_id: clientId,
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        default_rate: dto.default_rate,
        prices: dto.prices,
        ended_rate_ids: result.ended,
      },
    });
    return {
      schedule: { ...result.schedule, status: deriveStatus(result.schedule, today) },
      rates: result.rates.map((r) => ({ ...r, status: deriveStatus(r, today) })),
    };
  }
}

/**
 * End a scope's TIER-1 per-product prices from `from` (pending → deleted, current → bounded to the day
 * before, past untouched). Used when a scope's prices are re-set (products left on the default) and when
 * TIERS are switched back on (`CreateTierScheduleDto.end_product_base_prices`), so a tier-1 product price can
 * never keep overriding the top bracket of a new ladder. Returns the ids it changed.
 */
export async function endTierRatesWithinTx(
  tx: Prisma.TransactionClient,
  clientId: string | null,
  from: Date,
  opts: { excludeProductIds?: string[] } = {},
): Promise<string[]> {
  const rows = await tx.commissionTierRate.findMany({
    where: {
      client_id: clientId,
      tier_number: BASE_TIER,
      ...(opts.excludeProductIds?.length ? { product_id: { notIn: opts.excludeProductIds } } : {}),
    },
    select: { id: true, effective_from: true, effective_to: true },
  });
  const plan = planEndRows(rows, from);
  if (plan.deleteIds.length > 0) {
    await tx.commissionTierRate.deleteMany({ where: { id: { in: plan.deleteIds } } });
  }
  for (const b of plan.bound) {
    await tx.commissionTierRate.update({ where: { id: b.id }, data: { effective_to: b.effectiveTo } });
  }
  return [...plan.deleteIds, ...plan.bound.map((b) => b.id)];
}
