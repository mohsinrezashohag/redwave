/**
 * FlatRateService — effective-dated flat (non-tiered) product rates: greenfield internet, TV, home
 * phone. internet is tiered (rejected here). Scope = product_type; reuses shared supersession.
 * — SRS COMM-002, §7.2
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { deriveStatus, planSupersession, toUtcDateOnly } from '../../common/effective-dating';
import { parseEffectiveWindow } from './effective-dates.util';
import { CreateFlatRateDto, ListFlatRatesQuery } from './dto/flat-rate.dto';

@Injectable()
export class FlatRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListFlatRatesQuery) {
    const today = toUtcDateOnly(new Date());
    const rows = await this.prisma.commissionFlatRate.findMany({
      orderBy: [{ product_type: 'asc' }, { effective_from: 'asc' }],
    });
    let annotated = rows.map((r) => ({ ...r, status: deriveStatus(r, today) }));
    if (query.status && query.status !== 'all') {
      annotated = annotated.filter((r) => r.status === query.status);
    }
    return annotated;
  }

  async create(dto: CreateFlatRateDto, actorId: string) {
    await this.assertFlatRatable(dto.product_type);
    const { from, to, today } = parseEffectiveWindow(dto.effective_from, dto.effective_to);

    const existing = await this.prisma.commissionFlatRate.findMany({
      where: { product_type: dto.product_type }, // scope = product_type
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
          product_type: dto.product_type,
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
        amount: dto.amount,
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        superseded_pending_ids: plan.deletePendingIds,
        bounded_current_id: plan.boundCurrent?.id ?? null,
      },
    });
    return { ...created, status: deriveStatus(created, today) };
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
}
