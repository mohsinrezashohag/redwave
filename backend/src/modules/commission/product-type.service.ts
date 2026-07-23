/**
 * ProductTypeService — the configurable product-type catalogue (the engine's behaviour seam). The Super
 * Admin can ADD types (always standard_addon — billable, flat-rated, NOT tiered, NOT greenfield, so a new
 * type can never change tally/greenfield logic — #5/#9), relabel them, and deactivate non-core types. The 4
 * core types are is_system (behaviour locked, non-deletable, non-deactivatable).
 *
 * Per Q2, create may carry an INLINE commission flat rate (what we PAY the rep) written to the commission
 * stream in the SAME transaction — the catalogue row itself stores no rate (#3 separation holds).
 * — SRS §6/§7, CLAUDE §6
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { parseEffectiveWindow } from './effective-dates.util';
import { CreateProductTypeDto, ListProductTypesQuery, UpdateProductTypeDto } from './dto/product-type.dto';

@Injectable()
export class ProductTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Reference list (authenticated). Core/system types first, then alphabetical. */
  async list(query: ListProductTypesQuery) {
    return this.prisma.productTypeCatalogue.findMany({
      where: query.status === 'active' ? { is_active: true } : {},
      orderBy: [{ is_system: 'desc' }, { key: 'asc' }],
    });
  }

  /**
   * Add a new product type. behaviour is forced standard_addon (never client-supplied). An optional inline
   * commission flat rate is written in the same transaction (a brand-new type has no prior rate → no
   * supersession). — Q2
   */
  async create(dto: CreateProductTypeDto, actorId: string) {
    const existing = await this.prisma.productTypeCatalogue.findUnique({ where: { key: dto.key }, select: { key: true } });
    if (existing) {
      throw new ConflictException(`Product type '${dto.key}' already exists`);
    }
    // Validate the inline rate window up-front (back-dating → 422) so we never half-create.
    const flat = dto.initial_flat_rate
      ? { ...parseEffectiveWindow(dto.initial_flat_rate.effective_from), amount: dto.initial_flat_rate.amount }
      : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const type = await tx.productTypeCatalogue.create({
        data: {
          key: dto.key,
          label: dto.label,
          behaviour: 'standard_addon', // FORCED — a new type can never be tiered/greenfield (#5/#9)
          is_system: false,
          is_active: true,
        },
      });
      if (flat) {
        await tx.commissionFlatRate.create({
          data: {
            client_id: null, // the GLOBAL rate for the new type (per-client overrides are added separately)
            product_type: type.key, // commission stream — what we PAY the rep (#3)
            amount: flat.amount,
            effective_from: flat.from,
            effective_to: null,
            created_by: actorId,
          },
        });
      }
      return type;
    });

    await this.audit.log({
      actorId,
      entityType: 'product_type_catalogue',
      entityId: created.key,
      action: 'create',
      after: {
        key: created.key,
        label: created.label,
        behaviour: created.behaviour,
        initial_flat_rate: dto.initial_flat_rate ?? null,
      },
    });
    return created;
  }

  /** Relabel and/or activate/deactivate a type. Key + behaviour are immutable; system types stay active. */
  async update(key: string, dto: UpdateProductTypeDto, actorId: string) {
    const before = await this.prisma.productTypeCatalogue.findUnique({ where: { key } });
    if (!before) {
      throw new NotFoundException('Product type not found');
    }
    if (dto.is_active === false && before.is_system) {
      throw new UnprocessableEntityException('A core (system) product type cannot be deactivated');
    }
    const updated = await this.prisma.productTypeCatalogue.update({
      where: { key },
      data: { label: dto.label, is_active: dto.is_active }, // key + behaviour intentionally immutable
    });
    await this.audit.log({
      actorId,
      entityType: 'product_type_catalogue',
      entityId: key,
      action: dto.is_active === false && before.is_active ? 'deactivate' : 'update',
      before,
      after: updated,
    });
    return updated;
  }
}
