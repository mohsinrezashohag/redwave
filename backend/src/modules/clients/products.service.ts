/**
 * ProductsService — per-client products with soft-deactivate. No global catalogue: a product
 * always belongs to a client. product_type is immutable after creation. — SRS CLNT-002/006
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { CreateProductDto, ListAllProductsQuery, ListProductsQuery, UpdateProductDto } from './dto/product.dto';
import { activeStatusWhere } from './clients.service';
import { dateOnly } from '../../common/effective-dating';
import { winnipegDateOnly } from '../../common/timezone';

@Injectable()
export class ProductsService {
  /** Columns a client may sort the cross-client list on (allowlist — the orderBy-injection guard). */
  private static readonly SORTABLE = ['name', 'product_type', 'is_active', 'created_at'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The nested per-client products panel — a plain array (not paginated; the client detail screen owns it). */
  async findAllForClient(clientId: string, query: ListProductsQuery) {
    await this.assertClientExists(clientId);
    return this.prisma.product.findMany({
      where: { client_id: clientId, ...activeStatusWhere(query.status) },
      orderBy: { created_at: 'asc' },
    });
  }

  /** The cross-client product list (GET /v1/products) — paginated + filterable + name search. */
  async findAll(query: ListAllProductsQuery) {
    const where: Prisma.ProductWhereInput = {
      ...activeStatusWhere(query.status),
      ...(query.client_id ? { client_id: query.client_id } : {}),
      ...(query.product_type ? { product_type: query.product_type } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, ProductsService.SORTABLE, { created_at: 'asc' });
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy, skip, take }),
      this.prisma.product.count({ where }),
    ]);
    return buildPage(data, total, page, limit);
  }

  async create(clientId: string, dto: CreateProductDto, actorId: string) {
    await this.assertClientExists(clientId);
    await this.assertProductTypeActive(dto.product_type);

    // Validate the optional inline CLIENT-BILLING rate window up-front (back-dating → 422) so we never
    // half-create the product. The rate write is a separate billing-stream concern (#3). — Q2 (item 2)
    const initialRate = dto.initial_billing_rate;
    if (initialRate) {
      const from = dateOnly(initialRate.effective_from);
      if (from.getTime() < winnipegDateOnly().getTime()) {
        throw new UnprocessableEntityException('initial_billing_rate.effective_from cannot be in the past');
      }
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          client_id: clientId, // attaches the product to the correct client — CLNT-002
          name: dto.name,
          product_type: dto.product_type,
          is_active: true,
        },
      });
      if (initialRate) {
        await tx.clientBillingRate.create({
          data: {
            client_id: clientId,
            product_id: created.id,
            rate_kind: 'product',
            amount: initialRate.amount, // decimal STRING → Prisma Decimal (exact; never float, #1)
            effective_from: dateOnly(initialRate.effective_from),
            effective_to: null,
            created_by: actorId,
          },
        });
      }
      return created;
    });

    await this.audit.log({
      actorId,
      entityType: 'products',
      entityId: product.id,
      action: 'create',
      after: {
        client_id: clientId,
        name: product.name,
        product_type: product.product_type,
        initial_billing_rate: initialRate ?? null,
      },
    });
    return product;
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException('Product not found');
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { name: dto.name, is_active: dto.is_active }, // product_type intentionally not editable
    });
    await this.audit.log({
      actorId,
      entityType: 'products',
      entityId: id,
      action: dto.is_active === false && before.is_active ? 'deactivate' : 'update',
      before,
      after: updated,
    });
    return updated;
  }

  private async assertClientExists(clientId: string): Promise<void> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }

  /** A product's type must be an ACTIVE catalogue key (the DTO no longer enforces a fixed enum). */
  private async assertProductTypeActive(key: string): Promise<void> {
    const type = await this.prisma.productTypeCatalogue.findUnique({ where: { key }, select: { is_active: true } });
    if (!type || !type.is_active) {
      throw new UnprocessableEntityException(`Unknown or inactive product type '${key}'`);
    }
  }
}
