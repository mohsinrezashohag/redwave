/**
 * SalesService — sale entry, the Sale ID, the lifecycle state machine, validation, and the
 * greenfield two-step. PRODUCES activations the engine consumes but runs NO commission math:
 * sale_items snapshot fields (rate_applied, commission_paid, incentive_amount)
 * stay NULL until Pay Run (#5). sale_date GOVERNS the pay period (#7). Data is scoped in the QUERY
 * via ScopeService (rep=own, manager=roster, admin=all). — SRS §8 / §16, arch §6.5
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AvatarService } from '../../common/avatar/avatar.service';
import { Prisma } from '@prisma/client';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
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
import { ExportSalesDto, SaleExportFilters } from './dto/sale-export.dto';
import { PaginationQuery } from '../../common/pagination/pagination.query';

/** One export's row cap — the browser builds the file, so keep it to what a spreadsheet handles well. */
export const MAX_EXPORT_ROWS = 5000;

/** A logged export, as the history and the "last exported" line show it. */
export function toExportLogRow(r: {
  id: string;
  generated_at: Date;
  format: string;
  filename: string;
  row_count: number | null;
  only_new: boolean;
  scope_filters: Prisma.JsonValue;
  generator: { full_name: string } | null;
}) {
  return {
    id: r.id,
    generated_at: r.generated_at,
    generated_by_name: r.generator?.full_name ?? null,
    format: r.format,
    filename: r.filename,
    row_count: r.row_count,
    only_new: r.only_new,
    filters: (r.scope_filters ?? {}) as SaleExportFilters,
  };
}
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { CommissionConfigProvider } from '../commission/commission-config.provider';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { mapToEngineProductType } from '../payrun/activation-mapping.logic';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/**
 * The customer-name fields to write. The client bill prints first and last name as separate columns, so a
 * sale captures them separately and the single display name is DERIVED — the two can never drift apart.
 * A caller that sends only `customer_name` (imports, legacy clients) still works: the pair stays null and
 * the statement falls back to splitting the display name.
 */
function customerNameFields(dto: { customer_name?: string; customer_first_name?: string; customer_last_name?: string }) {
  const first = dto.customer_first_name?.trim() || null;
  const last = dto.customer_last_name?.trim() || null;
  const derived = [first, last].filter(Boolean).join(' ');
  return {
    customer_name: derived || (dto.customer_name ?? ''),
    customer_first_name: first,
    customer_last_name: last,
  };
}
// Default sale_date = the CANONICAL Winnipeg calendar day (#7), so a late-night sale never lands in the
// wrong pay period under UTC. — CLAUDE §11
// Each item carries its product's NAME as well as its type key: the client bill prints the internet SPEED
// ("Fibre 1gig/2.5gig"), and a per-speed sales export has to name it too — the type key alone can't. — SALE-004
/** The rep identity carried on every sale read (see SALE_INCLUDE). */
type RepIdentity = { rep_code: string; external_code: string | null; full_name: string };

const SALE_INCLUDE = {
  sale_items: { include: { product: { select: { name: true } } } },
  // The rep who sold it. `external_code` is the PARTNER-facing Agent ID (what a client's own roster is
  // keyed by); `rep_code` is our internal one and the fallback. Carrying both lets the sales export line
  // up with a client statement agent-for-agent — the statement freezes the same pair. — packet: small items
  rep: { select: { rep_code: true, external_code: true, full_name: true } },
} as const;

@Injectable()
export class SalesService {
  /** Columns a client may sort the list on (allowlist — the orderBy-injection guard). */
  private static readonly SORTABLE = ['sale_code', 'customer_name', 'sale_date', 'status', 'created_at'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
    @Optional() private readonly avatars?: AvatarService,
    @Optional() private readonly commissionConfig?: CommissionConfigProvider,
    @Optional() private readonly engine?: CommissionEngineService,
  ) {}

  /**
   * Resolve + VALIDATE everything a sale entry needs, against `db` (the live client OR a caller's tx).
   * This is the SINGLE implementation of the sale-entry rules — the public `create` and the tx-aware
   * `createWithinTx` both go through it, so no caller (notably the Import commit) ever reimplements sale
   * creation. Performs no writes; returns a `data(saleCode)` builder for the caller to write once the
   * sale_code is resolved. — SRS SALE-001/001a
   */
  private async resolveSaleCreate(
    db: Prisma.TransactionClient | PrismaService,
    dto: CreateSaleDto,
    user: AuthUser,
  ) {
    const repId = dto.rep_id ?? user.repId;
    if (!repId) {
      throw new UnprocessableEntityException('rep_id is required (the caller has no linked rep)');
    }
    await this.assertRepInScope(user, repId);

    const rep = await db.rep.findUnique({ where: { id: repId }, select: { status: true } });
    if (!rep || rep.status !== 'active') {
      throw new UnprocessableEntityException('rep does not exist or is not active');
    }

    const client = await db.client.findUnique({
      where: { id: dto.client_id },
      select: { id: true, is_active: true, client_code: true },
    });
    if (!client || !client.is_active) {
      throw new UnprocessableEntityException('client does not exist or is inactive');
    }

    // Every product must belong to this client and be active; capture its product_type + catalogue
    // behaviour (behaviour drives the internet-base rule below).
    const products = await db.product.findMany({
      where: { id: { in: dto.items.map((i) => i.product_id) }, client_id: client.id },
      select: {
        id: true,
        product_type: true,
        is_active: true,
        product_type_ref: { select: { behaviour: true } },
      },
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

    // Internet is the MANDATORY BASE of a sale; TV, Home Phone, Protection Plan, Mesh Extender and
    // Speed-attach are add-ons and cannot be sold standalone. Base = a product whose catalogue
    // behaviour is `internet` or `greenfield`; a sale of only `standard_addon` items is rejected.
    // — SRS SALE-001a (Meeting 3)
    const hasInternetBase = dto.items.some((item) => {
      const behaviour = productById.get(item.product_id)?.product_type_ref?.behaviour;
      return behaviour === 'internet' || behaviour === 'greenfield';
    });
    if (!hasInternetBase) {
      throw new UnprocessableEntityException(
        'a sale must include an internet activation (the mandatory base); add-ons cannot be sold standalone',
      );
    }

    const saleDate = dto.sale_date ?? todayInWinnipeg();
    const isGreenfield = dto.is_greenfield ?? false;
    const base = saleCodeBase({
      saleDate,
      clientCode: client.client_code,
      mpuId: dto.mpu_id ?? null,
    });

    const data = (saleCode: string, importBatchId?: string): Prisma.SaleUncheckedCreateInput => ({
      sale_code: saleCode,
      sale_date: dateOnly(saleDate), // KING — governs the pay period (#7)
      activation_date: dto.activation_date ? dateOnly(dto.activation_date) : null, // reference only
      rep_id: repId,
      client_id: client.id,
      // The client bill prints first + last name as separate columns, so capture them separately and DERIVE
      // the display name — the two can then never disagree. Callers that send only customer_name still work.
      ...customerNameFields(dto),
      street: dto.street,
      city: dto.city,
      province_state: dto.province_state,
      postal_code: dto.postal_code,
      mpu_id: dto.mpu_id ?? null,
      is_greenfield: isGreenfield,
      status: 'entered',
      ...(importBatchId ? { import_batch_id: importBatchId } : {}), // provenance (IMP-008)
      sale_items: {
        create: dto.items.map((item) => {
          const productType = productById.get(item.product_id)!.product_type;
          return {
            product_id: item.product_id,
            product_type: productType,
            counts_toward_tally: countsTowardTally(productType, isGreenfield),
            item_status: 'active' as const,
            // snapshot fields stay NULL — Pay Run freezes them at finalize (#5/#2)
          };
        }),
      },
    });

    return { repId, clientId: client.id, isGreenfield, base, data };
  }

  async create(dto: CreateSaleDto, user: AuthUser) {
    const resolved = await this.resolveSaleCreate(this.prisma, dto, user);
    const created = await this.createWithUniqueCode(resolved.base, (saleCode) =>
      this.prisma.sale.create({ data: resolved.data(saleCode), include: SALE_INCLUDE }),
    );

    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: created.id,
      action: 'create',
      after: {
        sale_code: created.sale_code,
        rep_id: resolved.repId,
        client_id: resolved.clientId,
        status: 'entered',
        item_count: dto.items.length,
        is_greenfield: resolved.isGreenfield,
      },
    });
    return created;
  }

  /**
   * Sale entry composable inside a CALLER'S transaction (no own `$transaction`, no audit) — the mirror of
   * `validateWithinTx`. The **Import** commit drives it so a whole batch of live sales is created
   * atomically (#8); the entry RULES live in `resolveSaleCreate` and are never reimplemented there. The
   * item snapshots stay NULL — importing a sale writes no commission (#2/#5).
   *
   * sale_code: the suffix count runs ON `tx`, so sales created earlier in the SAME batch are visible. The
   * public `create` retries on a P2002 race, but a retry is impossible inside a Postgres transaction (a
   * failed statement aborts it), so a genuine collision here rolls the whole batch back — which is the
   * correct outcome for an atomic import. — SALE-001/003, IMP-013
   */
  async createWithinTx(
    tx: Prisma.TransactionClient,
    dto: CreateSaleDto,
    user: AuthUser,
    opts: { importBatchId?: string } = {},
  ) {
    const resolved = await this.resolveSaleCreate(tx, dto, user);
    const existingCount = await tx.sale.count({
      where: { OR: [{ sale_code: resolved.base }, { sale_code: { startsWith: `${resolved.base}-` } }] },
    });
    return tx.sale.create({
      data: resolved.data(withSuffix(resolved.base, existingCount), opts.importBatchId),
      include: SALE_INCLUDE,
    });
  }

  async edit(id: string, dto: UpdateSaleDto, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    // Identity fields (client/sale_date/mpu) are immutable; only Entered sales are editable.
    if (sale.status !== 'entered') {
      throw new ConflictException('only entered sales can be edited');
    }
    // Editing the name goes through the same derive-from-the-pair rule as create, so a corrected first/last
    // always reaches the display name too.
    const nameEdit =
      dto.customer_first_name !== undefined || dto.customer_last_name !== undefined
        ? customerNameFields({
            customer_name: dto.customer_name ?? sale.customer_name,
            customer_first_name: dto.customer_first_name ?? sale.customer_first_name ?? undefined,
            customer_last_name: dto.customer_last_name ?? sale.customer_last_name ?? undefined,
          })
        : { customer_name: dto.customer_name };
    const updated = await this.prisma.sale.update({
      where: { id },
      data: {
        ...nameEdit,
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
    // Best-effort, post-commit: notify the rep their sale was validated. — sale_validated / RPT-009
    const rep = await this.prisma.rep.findUnique({ where: { id: updated.rep_id }, select: { user_id: true } });
    await this.emitter.emitMany([rep?.user_id], {
      eventType: 'sale_validated',
      title: `Sale ${updated.sale_code} validated`,
      body: `Your sale for ${updated.customer_name} has been validated.`,
      relatedEntityType: 'sales',
      relatedEntityId: updated.id,
      variables: { sale_code: updated.sale_code, customer_name: updated.customer_name },
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
    const where = await this.listWhere(query, user);
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, SalesService.SORTABLE, { sale_date: 'desc' });

    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({ where, include: SALE_INCLUDE, orderBy, skip, take }),
      this.prisma.sale.count({ where }), // same `where` → an accurate total for the meta
    ]);
    return buildPage(await this.attachPeriods(rows), total, page, limit);
  }

  // ── Sales export log (client request 2026-11-11) ──────────────────────────────────────────────
  // Redwave exports sales whenever they like and does the pay maths in Excel. Every export is RECORDED
  // FIRST (who / when / format / filters / row count + exactly which sales), then the rows are returned for
  // the browser to build the file — "no record, no file", as for report exports (RPT-015). An export uses
  // the SAME scoped where as the list (§5), so a rep can only ever export their own sales.

  /** Record an export and return its rows. `only_new` = sales never included in an earlier sales export. */
  async exportSales(dto: ExportSalesDto, user: AuthUser) {
    const where = await this.exportWhere(dto.filters ?? {}, dto.only_new ?? false, user);
    const count = await this.prisma.sale.count({ where });
    if (count > MAX_EXPORT_ROWS) {
      throw new UnprocessableEntityException(
        `${count} sales match. Narrow the filters (date range, client, status) to ${MAX_EXPORT_ROWS} or fewer per export.`,
      );
    }
    const rows = await this.prisma.sale.findMany({ where, include: SALE_INCLUDE, orderBy: { sale_date: 'desc' } });
    // Nothing matched (e.g. "only new" right after an export): no file is produced, so nothing is logged —
    // an empty entry would only clutter the history.
    if (rows.length === 0) {
      return { export: null, rows: [] };
    }

    const log = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.reportExport.create({
          data: {
            generated_by: user.id,
            report_type: 'sales',
            format: dto.format,
            scope_filters: (dto.filters ?? {}) as Prisma.InputJsonValue,
            filename: dto.filename,
            row_count: rows.length,
            only_new: dto.only_new ?? false,
          },
        });
        await tx.reportExportSale.createMany({
          data: rows.map((r) => ({ report_export_id: created.id, sale_id: r.id })),
        });
        return created;
      },
      { timeout: 60_000 },
    );
    await this.audit.log({
      actorId: user.id,
      entityType: 'report_exports',
      entityId: log.id,
      action: 'export',
      after: { report_type: 'sales', format: dto.format, row_count: rows.length, only_new: dto.only_new ?? false },
    });
    return {
      export: { id: log.id, generated_at: log.generated_at, row_count: rows.length, only_new: log.only_new, format: log.format },
      rows: await this.withEstimatedRates(await this.attachPeriods(rows)),
    };
  }

  /**
   * EXPORT ONLY (2026-11-15): give each not-yet-paid item of a live sale its rep rate IN FORCE on the sale
   * date, resolved exactly as the pay run will (most specific wins; greenfield internet pays the greenfield
   * rate, #5/#9). Redwave works tiers and splits out in Excel from this file, so they need the rate before
   * the pay run. It is an ESTIMATE: computed on the fly, never written, and a paid item keeps showing its
   * frozen snapshot (#2). Incentives are not estimated (they depend on the whole period).
   */
  private async withEstimatedRates<T extends { status: string; sale_date: Date; client_id: string; sale_items: Array<Record<string, unknown>> }>(
    sales: T[],
  ): Promise<T[]> {
    if (!this.commissionConfig || !this.engine) return sales;
    const ESTIMABLE = new Set(['entered', 'validated', 'in_pay_run']);
    const configs = new Map<string, Awaited<ReturnType<CommissionConfigProvider['getEngineConfig']>>>();
    const configFor = async (day: string) => {
      let c = configs.get(day);
      if (!c) {
        c = await this.commissionConfig!.getEngineConfig(day);
        configs.set(day, c);
      }
      return c;
    };
    const out: T[] = [];
    for (const sale of sales) {
      if (!ESTIMABLE.has(sale.status)) {
        out.push(sale);
        continue;
      }
      const day = sale.sale_date.toISOString().slice(0, 10);
      const config = await configFor(day);
      const items = sale.sale_items.map((item) => {
        if (item.rate_applied != null) return { ...item, estimated_rate: null };
        const rate = this.engine!.rateInForce(
          {
            id: String(item.id),
            productType: mapToEngineProductType(String(item.product_type), Boolean(item.counts_toward_tally)),
            clientId: sale.client_id,
            productId: (item.product_id as string | null) ?? null,
            saleDate: day,
          },
          config,
        );
        return { ...item, estimated_rate: rate ? rate.toFixed(2) : null };
      });
      out.push({ ...sale, sale_items: items });
    }
    return out;
  }

  /** "Last exported …" + how many sales match the filters, and how many of those were never exported. */
  async exportSummary(filters: SaleExportFilters, user: AuthUser) {
    const [matching, notYet, last] = await Promise.all([
      this.prisma.sale.count({ where: await this.exportWhere(filters, false, user) }),
      this.prisma.sale.count({ where: await this.exportWhere(filters, true, user) }),
      this.prisma.reportExport.findFirst({
        where: { report_type: 'sales', ...(await this.exportLogScope(user)) },
        orderBy: { generated_at: 'desc' },
        include: { generator: { select: { full_name: true } } },
      }),
    ]);
    return {
      matching,
      not_yet_exported: notYet,
      last_export: last ? toExportLogRow(last) : null,
    };
  }

  /** The export history, newest first. Users who see all sales see every export; others see their own. */
  async listExports(query: PaginationQuery, user: AuthUser) {
    const where: Prisma.ReportExportWhereInput = { report_type: 'sales', ...(await this.exportLogScope(user)) };
    const { skip, take, page, limit } = toSkipTake(query);
    const [rows, total] = await Promise.all([
      this.prisma.reportExport.findMany({
        where,
        orderBy: { generated_at: 'desc' },
        include: { generator: { select: { full_name: true } } },
        skip,
        take,
      }),
      this.prisma.reportExport.count({ where }),
    ]);
    return buildPage(rows.map(toExportLogRow), total, page, limit);
  }

  private async exportWhere(filters: SaleExportFilters, onlyNew: boolean, user: AuthUser): Promise<Prisma.SaleWhereInput> {
    const base = await this.listWhere(filters, user);
    // A deleted sale is not a sale: an export leaves it out unless the operator filtered FOR deleted sales.
    // (It used to ride along and was then logged as "exported", which skewed "only new".) 2026-11-15
    const live: Prisma.SaleWhereInput = filters.status ? base : { AND: [base, { status: { not: 'deleted' } }] };
    // "Not exported before" is company-wide: once anyone has exported a sale, it is no longer new.
    return onlyNew ? { AND: [live, { export_links: { none: {} } }] } : live;
  }

  private async exportLogScope(user: AuthUser): Promise<Prisma.ReportExportWhereInput> {
    return (await this.scopeRepIds(user)) === null ? {} : { generated_by: user.id };
  }

  /** The list's filters, SCOPED IN THE QUERY (§5). Shared by the list and every export read. */
  private async listWhere(query: SaleExportFilters, user: AuthUser): Promise<Prisma.SaleWhereInput> {
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

    return and.length ? { AND: and } : {};
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

  private async attachPeriods<T extends { sale_date: Date; rep_id: string; rep?: RepIdentity | null }>(sales: T[]) {
    const [periods, photos] = await Promise.all([
      this.prisma.payPeriod.findMany({
        select: { id: true, period_number: true, start_date: true, end_date: true },
      }),
      // The selling rep's photo (HR headshot), one batch per response. 2026-11-12
      this.avatars ? this.avatars.resolveReps(sales.map((s) => s.rep_id)) : Promise.resolve(new Map<string, string | null>()),
    ]);
    return sales.map((sale) => ({
      ...sale,
      pay_period: resolvePayPeriod(sale.sale_date, periods),
      // FLATTEN the rep onto the response so an export can print the Agent ID / Agent Name pair without
      // a second lookup — the same pair the client statement freezes, so the two line up agent-for-agent.
      rep_external_code: sale.rep?.external_code ?? null,
      rep_code: sale.rep?.rep_code ?? null,
      rep_name: sale.rep?.full_name ?? null,
      rep_photo_url: photos.get(sale.rep_id) ?? null,
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
