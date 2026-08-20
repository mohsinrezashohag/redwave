/**
 * FlatRateService — effective-dated flat (non-tiered) product rates: greenfield internet, TV, home
 * phone. internet is tiered (rejected here). Scope = (client_id, product_type, product_id) — client_id
 * null is the GLOBAL rate and product_id null is the whole-TYPE rate, each the fallback for anything
 * without its own; reuses shared supersession.
 *
 * The scope key includes product_id ON PURPOSE: a rate for ONE product must never supersede or bound the
 * type-wide rate (or another product's), or adding a premium-TV rate would silently stop every other TV
 * product being paid. Resolution at pay time is most-specific-first:
 *   (client + product) → (product) → (client + type) → (type).
 * — SRS COMM-002, §7.2; per-product rep rates
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { deriveStatus, planSupersession, previousDay, toUtcDateOnly } from '../../common/effective-dating';
import { parseEffectiveWindow } from './effective-dates.util';
import { assertPending, resolveEditWindow } from './effective-edit.util';
import { scopeWhere } from './client-scope.logic';
import { resolveClientScope } from './client-scope.util';
import { CreateFlatRateDto, ListFlatRatesQuery, UpdateFlatRateDto } from './dto/flat-rate.dto';

@Injectable()
export class FlatRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListFlatRatesQuery) {
    const today = toUtcDateOnly(new Date());
    const rows = await this.prisma.commissionFlatRate.findMany({
      where: scopeWhere(query.client_id),
      orderBy: [{ product_type: 'asc' }, { client_id: 'asc' }, { effective_from: 'asc' }],
    });
    let annotated = rows.map((r) => ({ ...r, status: deriveStatus(r, today) }));
    if (query.status && query.status !== 'all') {
      annotated = annotated.filter((r) => r.status === query.status);
    }
    return annotated;
  }

  async create(dto: CreateFlatRateDto, actorId: string) {
    await this.assertFlatRatable(dto.product_type);
    const productId = dto.product_id ?? null;
    if (productId) {
      await this.assertProductMatchesType(productId, dto.product_type);
    }
    const { from, to, today } = parseEffectiveWindow(dto.effective_from, dto.effective_to);

    // null = the GLOBAL rate for this type. Scope = (client, product_type, product_id): a client's rate
    // must never supersede or bound the global one (or another client's), and a PRODUCT rate must never
    // supersede the type-wide rate.
    const clientId = await resolveClientScope(this.prisma, dto.client_id);

    const existing = await this.prisma.commissionFlatRate.findMany({
      where: { client_id: clientId, product_type: dto.product_type, product_id: productId },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(existing, from, today);

    const created = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.commissionFlatRate.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.commissionFlatRate.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.commissionFlatRate.create({
        data: {
          client_id: clientId,
          product_type: dto.product_type,
          product_id: productId,
          amount: dto.amount, // decimal STRING → Prisma Decimal
          effective_from: from,
          effective_to: to,
          created_by: actorId,
        },
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'commission_flat_rates',
      entityId: created.id,
      action: 'create',
      after: {
        product_type: dto.product_type,
        product_id: productId,
        amount: dto.amount,
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        superseded_pending_ids: plan.deletePendingIds,
        bounded_current_id: plan.boundCurrent?.id ?? null,
      },
    });
    return { ...created, status: deriveStatus(created, today) };
  }

  /** Edit a PENDING flat rate (amount / effective window). product_type (the scope) is immutable. — #10 */
  async update(id: string, dto: UpdateFlatRateDto, actorId: string) {
    const row = await this.prisma.commissionFlatRate.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Flat rate not found');
    }
    assertPending(row);
    const { from, to, today } = resolveEditWindow(row, dto);

    const others = await this.prisma.commissionFlatRate.findMany({
      // Same SCOPE only — client_id + product_type + product_id are immutable on edit. Dropping product_id
      // here would let a pending PRODUCT rate supersede the type-wide rate.
      where: { client_id: row.client_id, product_type: row.product_type, product_id: row.product_id, id: { not: id } },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(others, from, today);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.commissionFlatRate.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.commissionFlatRate.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.commissionFlatRate.update({
        where: { id },
        data: { amount: dto.amount ?? row.amount, effective_from: from, effective_to: to },
      });
    });

    await this.audit.log({ actorId, entityType: 'commission_flat_rates', entityId: id, action: 'update', before: row, after: updated });
    return { ...updated, status: deriveStatus(updated, toUtcDateOnly(new Date())) };
  }

  /** Delete a PENDING flat rate; re-open any predecessor it had bounded (no gap). — #10 */
  async remove(id: string, actorId: string) {
    const row = await this.prisma.commissionFlatRate.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Flat rate not found');
    }
    assertPending(row);
    const predecessorEnd = previousDay(row.effective_from);
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionFlatRate.delete({ where: { id } });
      await tx.commissionFlatRate.updateMany({
        // Scope-bound by client AND product — otherwise this re-opens another client's, or the type-wide,
        // row and silently resurrects a rate that was correctly closed.
        where: {
          client_id: row.client_id,
          product_type: row.product_type,
          product_id: row.product_id,
          effective_to: predecessorEnd,
        },
        data: { effective_to: null },
      });
    });
    await this.audit.log({ actorId, entityType: 'commission_flat_rates', entityId: id, action: 'delete', before: row });
  }

  /**
   * A flat rate may only target a NON-tiered, active catalogue type. A tiered type (internet) is rejected
   * — it's priced by the tier schedule, never a flat rate (#5). Reads behaviour from the catalogue, so new
   * standard-add-on types are flat-ratable automatically.
   */
  private async assertFlatRatable(key: string): Promise<void> {
    const type = await this.prisma.productTypeCatalogue.findUnique({
      where: { key },
      select: { behaviour: true, is_active: true },
    });
    if (!type || !type.is_active) {
      throw new UnprocessableEntityException(`Unknown or inactive product type '${key}'`);
    }
    if (type.behaviour === 'tiered') {
      throw new UnprocessableEntityException(
        `'${key}' is tiered; flat rates apply to non-tiered (greenfield / add-on) types only`,
      );
    }
  }

  /**
   * A product-scoped rate must actually be a product OF that type. Without this a "TV" rate could be
   * attached to an internet product and would then never resolve — the item would fall through to the
   * type rate and the configured amount would silently do nothing.
   */
  private async assertProductMatchesType(productId: string, productType: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { product_type: true, is_active: true },
    });
    if (!product) {
      throw new UnprocessableEntityException(`Unknown product '${productId}'`);
    }
    if (product.product_type !== productType) {
      throw new UnprocessableEntityException(
        `product '${productId}' is a '${product.product_type}' product, not '${productType}'`,
      );
    }
  }
}
