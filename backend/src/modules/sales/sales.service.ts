/**
 * SalesService — sale entry, the Sale ID, the lifecycle state machine, validation, and the
 * greenfield two-step. PRODUCES activations the engine consumes but runs NO commission math:
 * sale_items snapshot fields (tier_at_payment, rate_applied, commission_paid, incentive_amount)
 * stay NULL until Pay Run (#5). sale_date GOVERNS the pay period (#7). Data is scoped in the QUERY
 * via ScopeService (rep=own, manager=roster, admin=all). — SRS §8 / §16, arch §6.5
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { todayInWinnipeg } from '../../common/timezone';
import { saleCodeBase, withSuffix } from './sale-id.logic';
import { assertTransition } from './sale-status.logic';
import { resolvePayPeriod } from './pay-period.logic';
import { countsTowardTally } from './sale-item.logic';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { ValidateSaleDto } from './dto/validate-sale.dto';
import { SetGreenfieldDto } from './dto/greenfield.dto';
import { BulkValidateDto } from './dto/bulk-validate.dto';
import { ListSalesQuery } from './dto/list-sales.query';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
// Default sale_date = the CANONICAL Winnipeg calendar day (#7), so a late-night sale never lands in the
// wrong pay period under UTC. — CLAUDE §11
const SALE_INCLUDE = { sale_items: true } as const;

@Injectable()
export class SalesService {
  /** Columns a client may sort the list on (allowlist — the orderBy-injection guard). */
  private static readonly SORTABLE = ['sale_code', 'customer_name', 'sale_date', 'status', 'created_at'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async create(dto: CreateSaleDto, user: AuthUser) {
    const repId = dto.rep_id ?? user.repId;
    if (!repId) {
      throw new UnprocessableEntityException('rep_id is required (the caller has no linked rep)');
    }
    await this.assertRepInScope(user, repId);

    const rep = await this.prisma.rep.findUnique({
      where: { id: repId },
      select: { status: true },
    });
    if (!rep || rep.status !== 'active') {
      throw new UnprocessableEntityException('rep does not exist or is not active');
    }

    const client = await this.prisma.client.findUnique({
      where: { id: dto.client_id },
      select: { id: true, is_active: true, client_code: true },
    });
    if (!client || !client.is_active) {
      throw new UnprocessableEntityException('client does not exist or is inactive');
    }

    // Every product must belong to this client and be active; capture its product_type.
    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((i) => i.product_id) }, client_id: client.id },
      select: { id: true, product_type: true, is_active: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      const product = productById.get(item.product_id);
      if (!product || !product.is_active) {
        throw new UnprocessableEntityException(
          `product ${item.product_id} does not belong to the client or is inactive`,
        );
      }
    }

    const saleDate = dto.sale_date ?? todayInWinnipeg();
    const isGreenfield = dto.is_greenfield ?? false;
    const base = saleCodeBase({
      saleDate,
      clientCode: client.client_code,
      mpuId: dto.mpu_id ?? null,
    });

    const created = await this.createWithUniqueCode(base, (saleCode) =>
      this.prisma.sale.create({
        data: {
          sale_code: saleCode,
          sale_date: dateOnly(saleDate), // KING — governs the pay period (#7)
          activation_date: dto.activation_date ? dateOnly(dto.activation_date) : null, // reference only
          rep_id: repId,
          client_id: client.id,
          customer_name: dto.customer_name,
          street: dto.street,
          city: dto.city,
          province_state: dto.province_state,
          postal_code: dto.postal_code,
          mpu_id: dto.mpu_id ?? null,
          is_greenfield: isGreenfield,
          status: 'entered',
          sale_items: {
            create: dto.items.map((item) => {
              const productType = productById.get(item.product_id)!.product_type;
              return {
                product_id: item.product_id,
                product_type: productType,
                counts_toward_tally: countsTowardTally(productType, isGreenfield),
                item_status: 'active',
                // snapshot fields stay NULL — Pay Run freezes them at finalize (#5/#2)
              };
            }),
          },
        },
        include: SALE_INCLUDE,
      }),
    );

    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: created.id,
      action: 'create',
      after: {
        sale_code: created.sale_code,
        rep_id: repId,
        client_id: client.id,
        status: 'entered',
        item_count: dto.items.length,
        is_greenfield: isGreenfield,
      },
    });
    return created;
  }

  async edit(id: string, dto: UpdateSaleDto, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    // Identity fields (client/sale_date/mpu) are immutable; only Entered sales are editable.
    if (sale.status !== 'entered') {
      throw new ConflictException('only entered sales can be edited');
    }
    const updated = await this.prisma.sale.update({
      where: { id },
      data: {
        customer_name: dto.customer_name,
        street: dto.street,
        city: dto.city,
        province_state: dto.province_state,
        postal_code: dto.postal_code,
        activation_date:
          dto.activation_date !== undefined
            ? dto.activation_date
              ? dateOnly(dto.activation_date)
              : null
            : undefined,
      },
      include: SALE_INCLUDE,
    });
    await this.audit.log({ actorId: user.id, entityType: 'sales', entityId: id, action: 'update' });
    return updated;
  }

  /** entered → validated. Approval gate; NEVER changes sale_date (the pay period is fixed). — SALE-005/010 */
  async validate(id: string, dto: ValidateSaleDto, user: AuthUser) {
    const updated = await this.prisma.$transaction((tx) =>
      this.validateWithinTx(tx, id, dto, user),
    );
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: id,
      action: 'validate',
      before: { status: 'entered' },
      after: { status: 'validated', is_greenfield: updated.is_greenfield },
    });
    return updated;
  }

  /**
   * The entered→validated transition, composable inside a CALLER'S transaction (no own `$transaction`,
   * no audit). The public `validate` wraps this in a tx + audit; the **Import** commit drives it with
   * its own tx so a whole batch validates atomically (#8) — the sale-state logic lives here, never
   * reimplemented elsewhere. — SALE-005/010, IMP-010
   */
  async validateWithinTx(
    tx: Prisma.TransactionClient,
    id: string,
    dto: ValidateSaleDto,
    user: AuthUser,
  ) {
    const sale = await this.loadScoped(id, user, tx);
    assertTransition(sale.status, 'validated'); // 409 unless currently 'entered'
    if (dto.is_greenfield !== undefined && dto.is_greenfield !== sale.is_greenfield) {
      await this.applyGreenfield(tx, id, dto.is_greenfield);
    }
    return tx.sale.update({
      where: { id },
      data: { status: 'validated', validated_by: user.id, validated_at: new Date() },
      include: SALE_INCLUDE,
    });
  }

  /** Batch-validate selected queue items. Non-entered sales are reported, not thrown. Reusable by Import. */
  async bulkValidate(dto: BulkValidateDto, user: AuthUser) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of dto.sale_ids) {
      try {
        await this.validate(id, {}, user);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : 'error' });
      }
    }
    return {
      validated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /** Confirm/clear greenfield (PROPOSED §17.2). Allowed only before the sale enters a pay run. */
  async setGreenfield(id: string, dto: SetGreenfieldDto, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    if (sale.status !== 'entered' && sale.status !== 'validated') {
      throw new ConflictException('greenfield can only be set before the sale enters a pay run');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyGreenfield(tx, id, dto.is_greenfield);
      return tx.sale.findUniqueOrThrow({ where: { id }, include: SALE_INCLUDE });
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: id,
      action: 'greenfield',
      after: { is_greenfield: dto.is_greenfield },
    });
    return updated;
  }

  /** Soft delete (entered|validated → status=deleted). The row is preserved (§16 'Deleted' state). */
  async remove(id: string, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    assertTransition(sale.status, 'deleted'); // 409 once in_pay_run/paid/clawed_back/deleted
    const updated = await this.prisma.sale.update({
      where: { id },
      data: { status: 'deleted' },
      select: { id: true, status: true },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: id,
      action: 'delete',
      before: { status: sale.status },
      after: { status: 'deleted' },
    });
    return updated;
  }

  async list(query: ListSalesQuery, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    const and: Prisma.SaleWhereInput[] = [];
    if (repIds !== null) and.push({ rep_id: { in: repIds } }); // scope in the query (#5/§5)
    if (query.rep_id) and.push({ rep_id: query.rep_id }); // intersected with scope
    if (query.status) and.push({ status: query.status });
    if (query.client_id) and.push({ client_id: query.client_id });
    if (query.date_from) and.push({ sale_date: { gte: dateOnly(query.date_from) } });
    if (query.date_to) and.push({ sale_date: { lte: dateOnly(query.date_to) } });
    if (query.search) {
      and.push({
        OR: [
          { sale_code: { contains: query.search, mode: 'insensitive' } },
          { customer_name: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.SaleWhereInput = and.length ? { AND: and } : {};
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, SalesService.SORTABLE, { sale_date: 'desc' });

    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({ where, include: SALE_INCLUDE, orderBy, skip, take }),
      this.prisma.sale.count({ where }), // same `where` → an accurate total for the meta
    ]);
    return buildPage(await this.attachPeriods(rows), total, page, limit);
  }

  async findOne(id: string, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    return (await this.attachPeriods([sale]))[0];
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────

  /** Set greenfield on a sale and recompute counts_toward_tally on its internet items. */
  private async applyGreenfield(
    tx: Prisma.TransactionClient,
    saleId: string,
    isGreenfield: boolean,
  ): Promise<void> {
    await tx.sale.update({ where: { id: saleId }, data: { is_greenfield: isGreenfield } });
    // Only internet items are affected; greenfield_internet/tv/home_phone are always false.
    await tx.saleItem.updateMany({
      where: { sale_id: saleId, product_type: 'internet' },
      data: { counts_toward_tally: !isGreenfield },
    });
  }

  /** Generate a unique sale_code (base or base-N), retrying on a P2002 race. */
  private async createWithUniqueCode<T>(
    base: string,
    create: (saleCode: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existingCount = await this.prisma.sale.count({
        where: { OR: [{ sale_code: base }, { sale_code: { startsWith: `${base}-` } }] },
      });
      try {
        return await create(withSuffix(base, existingCount));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue; // another sale took this code — recount and retry
        }
        throw error;
      }
    }
    throw new ConflictException('could not generate a unique sale_code; please retry');
  }

  private async attachPeriods<T extends { sale_date: Date }>(sales: T[]) {
    const periods = await this.prisma.payPeriod.findMany({
      select: { id: true, period_number: true, start_date: true, end_date: true },
    });
    return sales.map((sale) => ({
      ...sale,
      pay_period: resolvePayPeriod(sale.sale_date, periods),
    }));
  }

  private async loadScoped(
    id: string,
    user: AuthUser,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const repIds = await this.scopeRepIds(user);
    const sale = await db.sale.findFirst({
      where: { id, ...this.scopeWhere(repIds) },
      include: SALE_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    return sale;
  }

  /** null = unrestricted (admin/SA); otherwise the rep_ids the caller may see/act on. */
  private async scopeRepIds(user: AuthUser): Promise<string[] | null> {
    const scope = await this.scope.getRepScope(user);
    return scope.level === 'all' ? null : scope.repIds;
  }

  private scopeWhere(repIds: string[] | null): Prisma.SaleWhereInput {
    return repIds === null ? {} : { rep_id: { in: repIds } };
  }

  private async assertRepInScope(user: AuthUser, repId: string): Promise<void> {
    const repIds = await this.scopeRepIds(user);
    if (repIds === null || repIds.includes(repId)) {
      return;
    }
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: repId,
      action: 'access_denied',
      after: { reason: 'rep out of scope', rep_id: repId },
    });
    throw new ForbiddenException("you are not permitted to act on this rep's sales");
  }
}
