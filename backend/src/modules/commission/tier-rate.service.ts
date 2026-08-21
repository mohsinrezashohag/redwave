/**
 * TierRateService — effective-dated PER-PRODUCT rep tier rates: what one bracket pays for one product.
 *
 * WHAT THIS DOES NOT DO, and it is the important half. It does not touch the internet TALLY, which stays
 * ONE cross-client count over every internet activation (#5), and it does not touch the bracket
 * BOUNDARIES, which live on the tier schedule and still decide which tier that tally lands in for every
 * product alike. This resolves a RATE only — the same shape as the per-client scoping that already exists.
 *
 * Scope = (client_id, product_id, tier_number). client_id null = the rate for every client for that
 * product; a client's own row wins. A product with NO row here falls back to the tier schedule's own
 * rate_per_activation, so adding this table changed nobody's pay until a row exists.
 *
 * Supersession, back-date rejection and pending-only edits are the shared #10 machinery, identical to
 * flat rates and client billing rates. — per-product rep rates
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  deriveStatus,
  planSupersession,
  previousDay,
  selectEffectiveRate,
  toUtcDateOnly,
} from '../../common/effective-dating';
import { parseEffectiveWindow } from './effective-dates.util';
import { assertPending, resolveEditWindow } from './effective-edit.util';
import { scopeWhere } from './client-scope.logic';
import { resolveClientScope } from './client-scope.util';
import { CreateTierRateDto, ListTierRatesQuery, UpdateTierRateDto } from './dto/tier-rate.dto';

@Injectable()
export class TierRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTierRatesQuery) {
    const today = toUtcDateOnly(new Date());
    const rows = await this.prisma.commissionTierRate.findMany({
      where: {
        ...scopeWhere(query.client_id),
        ...(query.product_id ? { product_id: query.product_id } : {}),
      },
      include: { product: { select: { name: true, product_type: true } } },
      orderBy: [{ product_id: 'asc' }, { tier_number: 'asc' }, { client_id: 'asc' }, { effective_from: 'asc' }],
    });
    let annotated = rows.map((r) => ({ ...r, status: deriveStatus(r, today) }));
    if (query.status && query.status !== 'all') {
      annotated = annotated.filter((r) => r.status === query.status);
    }
    return annotated;
  }

  async create(dto: CreateTierRateDto, actorId: string) {
    const product = await this.assertTieredProduct(dto.product_id);
    const { from, to, today } = parseEffectiveWindow(dto.effective_from, dto.effective_to);
    const clientId = await resolveClientScope(this.prisma, dto.client_id);
    // A product belongs to exactly ONE client, so the product already implies the client. A rate scoped to
    // a DIFFERENT client could therefore never resolve — it would sit in the config looking configured and
    // silently pay nothing. Fail loudly instead, like the tiered-product and tier-exists checks.
    if (clientId !== null && clientId !== product.client_id) {
      throw new UnprocessableEntityException(
        `product '${dto.product_id}' belongs to another client; a rate scoped to this client would never apply`,
      );
    }

    // Checked LAST because it needs both the product's client and the date the rate starts.
    await this.assertTierExists(dto.tier_number, product.client_id, from);

    // Scope = (client, product, tier). All three matter: a rate for Tier 2 must not bound Tier 3, and one
    // client's rate must not bound another's or the cross-client one.
    const existing = await this.prisma.commissionTierRate.findMany({
      where: { client_id: clientId, product_id: dto.product_id, tier_number: dto.tier_number },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(existing, from, today);

    const created = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.commissionTierRate.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.commissionTierRate.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.commissionTierRate.create({
        data: {
          client_id: clientId,
          product_id: dto.product_id,
          tier_number: dto.tier_number,
          amount: dto.amount, // decimal STRING → Prisma Decimal (#1)
          effective_from: from,
          effective_to: to,
          created_by: actorId,
        },
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'commission_tier_rates',
      entityId: created.id,
      action: 'create',
      after: {
        client_id: clientId,
        product_id: dto.product_id,
        tier_number: dto.tier_number,
        amount: dto.amount,
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        superseded_pending_ids: plan.deletePendingIds,
        bounded_current_id: plan.boundCurrent?.id ?? null,
      },
    });
    return { ...created, status: deriveStatus(created, today) };
  }

  /** Edit a PENDING tier rate (amount / window). The scope (client, product, tier) is immutable. — #10 */
  async update(id: string, dto: UpdateTierRateDto, actorId: string) {
    const row = await this.prisma.commissionTierRate.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Tier rate not found');
    }
    assertPending(row);
    const { from, to, today } = resolveEditWindow(row, dto);

    const others = await this.prisma.commissionTierRate.findMany({
      where: {
        client_id: row.client_id,
        product_id: row.product_id,
        tier_number: row.tier_number,
        id: { not: id },
      },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(others, from, today);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.commissionTierRate.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.commissionTierRate.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.commissionTierRate.update({
        where: { id },
        data: { amount: dto.amount ?? row.amount, effective_from: from, effective_to: to },
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'commission_tier_rates',
      entityId: id,
      action: 'update',
      before: row,
      after: updated,
    });
    return { ...updated, status: deriveStatus(updated, toUtcDateOnly(new Date())) };
  }

  /** Delete a PENDING tier rate; re-open any predecessor it had bounded (no gap). — #10 */
  async remove(id: string, actorId: string) {
    const row = await this.prisma.commissionTierRate.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Tier rate not found');
    }
    assertPending(row);
    const predecessorEnd = previousDay(row.effective_from);
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionTierRate.delete({ where: { id } });
      await tx.commissionTierRate.updateMany({
        // Scope-bound on all three, or this re-opens another tier's or another client's closed row.
        where: {
          client_id: row.client_id,
          product_id: row.product_id,
          tier_number: row.tier_number,
          effective_to: predecessorEnd,
        },
        data: { effective_to: null },
      });
    });
    await this.audit.log({ actorId, entityType: 'commission_tier_rates', entityId: id, action: 'delete', before: row });
  }

  /**
   * A tier rate prices a TIERED product. Attaching one to a TV product would never resolve — the item is
   * flat-rated, so the configured amount would silently do nothing rather than fail.
   */
  private async assertTieredProduct(productId: string): Promise<{ client_id: string }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { client_id: true, product_type: true, product_type_ref: { select: { behaviour: true } } },
    });
    if (!product) {
      throw new UnprocessableEntityException(`Unknown product '${productId}'`);
    }
    if (product.product_type_ref.behaviour !== 'tiered') {
      throw new UnprocessableEntityException(
        `product '${productId}' is '${product.product_type}' (${product.product_type_ref.behaviour}); ` +
          'tier rates apply to TIERED products only — use a flat rate',
      );
    }
    return product;
  }

  /**
   * The tier must exist in the ladder that will ACTUALLY price this product — which is the product's
   * client's own schedule if it has one, else the global fallback. This mirrors the engine exactly
   * (`tiersByClient[clientId] ?? tiers`), and the mirroring is the whole point.
   *
   * Checking "does this tier number exist in ANY schedule" is not good enough, and the difference is not
   * academic: a client whose ladder has fewer brackets than the global one would accept a rate for a
   * bracket its activations can never land in. The rate would look configured, pass validation, and
   * silently pay the schedule rate forever — the exact "looks configured, pays nothing" failure the
   * surrounding guards exist to prevent. Validated on the rate's START date, since that is when it
   * begins to apply and the schedule in force then is the one that matters.
   */
  private async assertTierExists(tierNumber: number, productClientId: string, on: Date): Promise<void> {
    const configs = await this.prisma.commissionTierConfig.findMany({
      where: { OR: [{ client_id: productClientId }, { client_id: null }] },
      include: { tiers: { select: { tier_number: true } } },
    });
    const effectiveFor = (scope: string | null) =>
      selectEffectiveRate(configs.filter((c) => c.client_id === scope), on);
    // Most specific wins, same as the engine: the client's own ladder, else the global one.
    const schedule = effectiveFor(productClientId) ?? effectiveFor(null);
    if (!schedule) {
      throw new UnprocessableEntityException(
        `no tier schedule is in force on ${on.toISOString().slice(0, 10)} for this product's client`,
      );
    }
    if (!schedule.tiers.some((t) => t.tier_number === tierNumber)) {
      const available = [...new Set(schedule.tiers.map((t) => t.tier_number))].sort((a, b) => a - b);
      throw new UnprocessableEntityException(
        `tier ${tierNumber} is not in the schedule that prices this product ` +
          `(it has ${available.length === 0 ? 'no tiers' : `tier ${available.join(', ')}`}) — ` +
          'a rate for it could never apply',
      );
    }
  }
}
