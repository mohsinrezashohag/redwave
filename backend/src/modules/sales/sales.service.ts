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
import { DuplicateMatch, duplicateReasonText, findDuplicate, houseNumber, nameKey } from './sale-duplicate.logic';
import { DomainError } from '../../common/errors/domain-error';
import { isRegionCode, splitCityRegion } from '../../common/geo/regions';
import {
  diffSaleChanges,
  editWindowEndsOn,
  isSaleEditable,
  SaleChanges,
  SaleSnapshotForDiff,
} from './sale-edit.logic';
import { ListSaleEditRequestsQuery } from './dto/sale-edit-request.dto';
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

/** A sale as loadScoped reads it (with items + rep). */
type SaleWithItems = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;

type ResolvedProduct = {
  id: string;
  product_type: string;
  is_active: boolean;
  product_type_ref: { behaviour: string } | null;
};

/** A new sale_item row: snapshots stay NULL, Pay Run freezes them at finalize (#5/#2). */
function itemCreate(productById: Map<string, ResolvedProduct>, productId: string, isGreenfield: boolean) {
  const productType = productById.get(productId)!.product_type;
  return {
    product_id: productId,
    product_type: productType,
    counts_toward_tally: countsTowardTally(productType, isGreenfield),
    item_status: 'active' as const,
  };
}

/** Field labels for the edit-request diff (display only). */
const EDIT_LABELS: Record<string, string> = {
  customer_name: 'Customer',
  customer_first_name: 'First name',
  customer_last_name: 'Last name',
  street: 'Street',
  city: 'City',
  province_state: 'Province/State',
  postal_code: 'Postal code',
  activation_date: 'Activation date',
  is_greenfield: 'Greenfield',
  items: 'Products',
};

const WINDOW_CLOSED = 'This sale can no longer be edited (5-day window)';

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

    const productById = await this.resolveProducts(db, client.id, dto.items.map((i) => i.product_id));

    // A possible duplicate is never refused: it is created FLAGGED and held for an approver, so it cannot be
    // validated (and so never reaches a pay run) until approved. Since 2026-11-28 the flag fires on the same
    // MPU, the same street address + city, or the same customer name for this client (App Review Feedback
    // High #3); the pure rule is `sale-duplicate.logic`. Deleted sales don't count. Runs on `db`, so inside an
    // import commit it also sees the batch's own earlier rows. — §14 rule 8
    const duplicateOf = await this.findDuplicateFor(db, client.id, dto);

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
      // "Edmonton, AB" is stored as Edmonton: the province has its own column. 2026-11-18
      city: splitCityRegion(dto.city, dto.province_state).city ?? dto.city,
      province_state: dto.province_state,
      postal_code: dto.postal_code,
      mpu_id: dto.mpu_id ?? null,
      is_greenfield: isGreenfield,
      // No per-sale validation step any more (App Review Feedback, 2026-11-28): a clean sale counts as soon as
      // it is submitted. Only a flagged possible duplicate stays `entered`, waiting for an approver.
      ...(duplicateOf
        ? { status: 'entered' as const }
        : { status: 'validated' as const, validated_by: user.id, validated_at: new Date() }),
      duplicate_of_sale_id: duplicateOf?.id ?? null,
      duplicate_reason: duplicateOf?.reason ?? null,
      ...(importBatchId ? { import_batch_id: importBatchId } : {}), // provenance (IMP-008)
      sale_items: {
        create: dto.items.map((item) => itemCreate(productById, item.product_id, isGreenfield)),
      },
    });

    return { repId, clientId: client.id, isGreenfield, base, data, duplicateOf };
  }

  /**
   * The existing live sale (oldest first) this entry duplicates, if any. The query only NARROWS the candidates
   * (same client, not deleted, sharing the MPU, the house number or the name); `findDuplicate` decides.
   */
  private async findDuplicateFor(
    db: Prisma.TransactionClient | PrismaService,
    clientId: string,
    dto: Pick<CreateSaleDto, 'mpu_id' | 'street' | 'city' | 'customer_name' | 'customer_first_name' | 'customer_last_name'>,
  ): Promise<DuplicateMatch | null> {
    const name = customerNameFields(dto).customer_name ?? null;
    const mpu = dto.mpu_id?.trim() || null;
    const house = houseNumber(dto.street);
    const street = dto.street?.trim() || null;
    const or: Prisma.SaleWhereInput[] = [];
    if (mpu) or.push({ mpu_id: { equals: mpu, mode: 'insensitive' } });
    if (house) or.push({ street: { startsWith: house, mode: 'insensitive' } });
    else if (street && street !== '—') or.push({ street: { equals: street, mode: 'insensitive' } });
    if (nameKey(name)) or.push({ customer_name: { equals: name!.trim(), mode: 'insensitive' } });
    if (or.length === 0) return null;
    const candidates = await db.sale.findMany({
      where: { client_id: clientId, status: { not: 'deleted' }, OR: or },
      orderBy: { created_at: 'asc' }, // the ORIGINAL, not a later flagged copy
      select: { id: true, sale_code: true, customer_name: true, street: true, city: true, mpu_id: true },
      take: 200,
    });
    return findDuplicate({ customer_name: name, street: dto.street, city: dto.city, mpu_id: mpu }, candidates);
  }

  /**
   * Every product must belong to the client and be active, and the set must carry the mandatory internet
   * base. Shared by entry and by an edit that changes the products, so the two can never disagree.
   * — SRS SALE-001a (Meeting 3)
   */
  private async resolveProducts(
    db: Prisma.TransactionClient | PrismaService,
    clientId: string,
    productIds: string[],
  ): Promise<Map<string, ResolvedProduct>> {
    const products = await db.product.findMany({
      where: { id: { in: productIds }, client_id: clientId },
      select: {
        id: true,
        product_type: true,
        is_active: true,
        product_type_ref: { select: { behaviour: true } },
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) {
      const product = productById.get(id);
      if (!product || !product.is_active) {
        throw new UnprocessableEntityException(`product ${id} does not belong to the client or is inactive`);
      }
    }

    // Internet is the MANDATORY BASE of a sale; TV, Home Phone, Protection Plan, Mesh Extender and
    // Speed-attach are add-ons and cannot be sold standalone. Base = a product whose catalogue
    // behaviour is `internet` or `greenfield`; a sale of only `standard_addon` items is rejected.
    const hasInternetBase = productIds.some((id) => {
      const behaviour = productById.get(id)?.product_type_ref?.behaviour;
      return behaviour === 'internet' || behaviour === 'greenfield';
    });
    if (!hasInternetBase) {
      throw new UnprocessableEntityException(
        'a sale must include an internet activation (the mandatory base); add-ons cannot be sold standalone',
      );
    }
    return productById;
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
        status: resolved.duplicateOf ? 'entered' : 'validated',
        item_count: dto.items.length,
        is_greenfield: resolved.isGreenfield,
        duplicate_of_sale_id: resolved.duplicateOf?.id ?? null,
        duplicate_reason: resolved.duplicateOf?.reason ?? null,
      },
    });
    if (resolved.duplicateOf) {
      await this.notifyDuplicateFlagged([created.id]);
    }
    return (await this.decorate([created]))[0];
  }

  /**
   * Best-effort, post-commit: tell the approvers a sale was entered as a possible duplicate and is waiting
   * for them. The rep's field manager plus every Admin / Super Admin. The import commit calls this for the
   * sales its batch created. Never throws. — duplicate_sale_flagged, client meeting 2026-11-16
   */
  async notifyDuplicateFlagged(saleIds: string[]): Promise<void> {
    try {
      if (saleIds.length === 0) return;
      const sales = await this.prisma.sale.findMany({
        where: { id: { in: saleIds }, duplicate_of_sale_id: { not: null } },
        select: { id: true, sale_code: true, customer_name: true, duplicate_of_sale_id: true, duplicate_reason: true, rep: { select: { field_manager_id: true } } },
      });
      const originals = await this.saleCodesById(sales.map((s) => s.duplicate_of_sale_id!));
      for (const sale of sales) {
        const original = originals.get(sale.duplicate_of_sale_id!) ?? 'another sale';
        const event = {
          eventType: 'duplicate_sale_flagged',
          title: `Possible duplicate sale ${sale.sale_code}`,
          body: `Sale ${sale.sale_code} has ${duplicateReasonText(sale.duplicate_reason)} as ${original}. Review it: approve it to count it, or delete it.`,
          relatedEntityType: 'sales',
          relatedEntityId: sale.id,
          variables: { sale_code: sale.sale_code, original_sale_code: original, customer_name: sale.customer_name },
        };
        await this.notifyApprovers(sale.rep?.field_manager_id ?? null, event);
      }
    } catch {
      // best-effort: a notification failure never breaks the action that triggered it
    }
  }

  /** The rep's field manager (when set) plus every Admin and Super Admin. Best-effort. */
  private async notifyApprovers(
    managerUserId: string | null,
    event: { eventType: string; title: string; body: string; relatedEntityType: string; relatedEntityId: string; variables: Record<string, string> },
  ): Promise<void> {
    try {
      if (managerUserId) await this.emitter.emitMany([managerUserId], event);
      await this.emitter.emitRole('Admin', event);
      await this.emitter.emitRole('Super Admin', event);
    } catch {
      // best-effort
    }
  }

  private async saleCodesById(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.sale.findMany({ where: { id: { in: unique } }, select: { id: true, sale_code: true } });
    return new Map(rows.map((r) => [r.id, r.sale_code]));
  }

  /** Approve a sale flagged as a possible duplicate: it is validated in the same write. Idempotent. — 2026-11-16, 2026-11-28 */
  async approveDuplicate(id: string, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    if (!sale.duplicate_of_sale_id) {
      throw new ConflictException('this sale is not flagged as a possible duplicate');
    }
    if (sale.status === 'deleted') {
      throw new ConflictException('a deleted sale cannot be approved');
    }
    if (sale.duplicate_approved_at) {
      return (await this.decorate([sale]))[0]; // already approved — a retry is a no-op
    }
    // Approving IS the review (no separate validation step since 2026-11-28): a held sale becomes validated
    // in the same write, so it counts and can be paid. A sale already past entered keeps its status.
    const now = new Date();
    const updated = await this.prisma.sale.update({
      where: { id },
      data: {
        duplicate_approved_by: user.id,
        duplicate_approved_at: now,
        ...(sale.status === 'entered' ? { status: 'validated' as const, validated_by: user.id, validated_at: now } : {}),
      },
      include: SALE_INCLUDE,
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: id,
      action: 'approve_duplicate',
      before: { duplicate_approved_at: null },
      after: { duplicate_of_sale_id: sale.duplicate_of_sale_id, duplicate_approved_by: user.id, status: updated.status },
    });
    return (await this.decorate([updated]))[0];
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

  // ── Editing inside the 5-day window (client meeting 2026-11-16) ─────────────────────────────────
  // An admin/manager (sales:edit) edits directly; a rep sends an EDIT REQUEST that an approver applies
  // through this same path. Both are held to the same window and the same frozen-status rule.

  /** Direct edit (sales:edit). Applies at once and is audited. */
  async edit(id: string, dto: UpdateSaleDto, user: AuthUser) {
    const { before, changes } = await this.prisma.$transaction(async (tx) => {
      const sale = await this.loadScoped(id, user, tx);
      const changes = diffSaleChanges(this.snapshotForDiff(sale), dto);
      await this.applyChanges(tx, sale, changes);
      return { before: sale, changes };
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: id,
      action: 'update',
      before: this.pickBefore(before, changes),
      after: changes as Prisma.InputJsonValue,
    });
    return this.findOne(id, user);
  }

  /** The sale reduced to its editable fields, for the diff. */
  private snapshotForDiff(sale: SaleWithItems): SaleSnapshotForDiff {
    return {
      customer_name: sale.customer_name,
      customer_first_name: sale.customer_first_name,
      customer_last_name: sale.customer_last_name,
      street: sale.street,
      city: sale.city,
      province_state: sale.province_state,
      postal_code: sale.postal_code,
      activation_date: sale.activation_date,
      is_greenfield: sale.is_greenfield,
      product_ids: sale.sale_items.map((i) => i.product_id),
    };
  }

  private pickBefore(sale: SaleWithItems, changes: SaleChanges): Prisma.InputJsonValue {
    const snap = this.snapshotForDiff(sale);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      if (key === 'items') out.items = snap.product_ids;
      else if (key === 'activation_date') out.activation_date = snap.activation_date?.toISOString().slice(0, 10) ?? null;
      else out[key] = (snap as unknown as Record<string, unknown>)[key];
    }
    return out as Prisma.InputJsonValue;
  }

  /** 422 unless the sale is still editable (entered/validated AND inside the 5-day window). */
  private assertEditable(sale: { status: string; created_at: Date }): void {
    if (!isSaleEditable(sale.status, sale.created_at, todayInWinnipeg())) {
      throw new DomainError('SALE_EDIT_WINDOW_CLOSED', WINDOW_CLOSED);
    }
  }

  /**
   * Write `changes` to the sale inside `tx`. Re-checks the window + status, re-runs the entry rules on a new
   * product list (they belong to the client, SALE-001a internet base) and recomputes counts_toward_tally
   * when the greenfield flag or the products change. Items carry no snapshot yet (entered/validated sales
   * are never paid), so a removed product's item is deleted and a new one created; a kept item is untouched.
   */
  private async applyChanges(tx: Prisma.TransactionClient, sale: SaleWithItems, changes: SaleChanges): Promise<void> {
    this.assertEditable(sale);
    if (Object.keys(changes).length === 0) {
      throw new DomainError('SALE_EDIT_NO_CHANGES', 'Nothing was changed.');
    }
    if (changes.province_state !== undefined && !isRegionCode(changes.province_state)) {
      throw new DomainError('SALE_REGION_INVALID', 'Province/State must be a province, territory or US state code.');
    }

    const isGreenfield = changes.is_greenfield ?? sale.is_greenfield;
    const nameTouched =
      changes.customer_first_name !== undefined ||
      changes.customer_last_name !== undefined ||
      changes.customer_name !== undefined;
    const nameEdit = nameTouched
      ? customerNameFields({
          customer_name: changes.customer_name ?? sale.customer_name,
          customer_first_name:
            (changes.customer_first_name !== undefined ? changes.customer_first_name : sale.customer_first_name) ?? undefined,
          customer_last_name:
            (changes.customer_last_name !== undefined ? changes.customer_last_name : sale.customer_last_name) ?? undefined,
        })
      : {};

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        ...nameEdit,
        street: changes.street,
        city:
          changes.city !== undefined
            ? splitCityRegion(changes.city, changes.province_state ?? sale.province_state).city ?? changes.city
            : undefined,
        province_state: changes.province_state,
        postal_code: changes.postal_code,
        activation_date:
          changes.activation_date !== undefined
            ? changes.activation_date
              ? dateOnly(changes.activation_date)
              : null
            : undefined,
        is_greenfield: changes.is_greenfield,
      },
    });

    if (changes.items) {
      const productById = await this.resolveProducts(tx, sale.client_id, changes.items);
      const keep = new Set(changes.items);
      const removed = sale.sale_items.filter((i) => !keep.has(i.product_id));
      // Defensive (#2): never touch an item that already carries a frozen snapshot.
      if (removed.some((i) => i.commission_paid !== null || i.rate_applied !== null)) {
        throw new DomainError('SALE_EDIT_FROZEN_ITEM', WINDOW_CLOSED);
      }
      if (removed.length > 0) {
        await tx.saleItem.deleteMany({ where: { id: { in: removed.map((i) => i.id) }, sale_id: sale.id } });
      }
      const existing = new Set(sale.sale_items.map((i) => i.product_id));
      const added = changes.items.filter((pid) => !existing.has(pid));
      if (added.length > 0) {
        await tx.saleItem.createMany({
          data: added.map((pid) => ({ sale_id: sale.id, ...itemCreate(productById, pid, isGreenfield) })),
        });
      }
    }
    if (changes.is_greenfield !== undefined) {
      await this.applyGreenfield(tx, sale.id, isGreenfield);
    }
  }

  /**
   * A rep's edit of their OWN sale (no sales:edit): stored as a pending request with only the changed
   * fields, and the approvers are notified. Same window, same rules (checked now and again at approval).
   */
  async requestEdit(id: string, dto: UpdateSaleDto, user: AuthUser) {
    const sale = await this.loadScoped(id, user);
    if (!user.repId || sale.rep_id !== user.repId) {
      throw new ForbiddenException('you can request an edit only for your own sale');
    }
    this.assertEditable(sale);
    const changes = diffSaleChanges(this.snapshotForDiff(sale), dto);
    if (Object.keys(changes).length === 0) {
      throw new DomainError('SALE_EDIT_NO_CHANGES', 'Nothing was changed.');
    }
    if (changes.items) {
      await this.resolveProducts(this.prisma, sale.client_id, changes.items); // fail now, not at approval
    }
    const pending = await this.prisma.saleEditRequest.findFirst({ where: { sale_id: id, status: 'pending' }, select: { id: true } });
    if (pending) {
      throw new ConflictException('An edit request for this sale is already waiting for a decision.');
    }
    const request = await this.prisma.saleEditRequest.create({
      data: { sale_id: id, requested_by: user.id, changes: changes as Prisma.InputJsonValue, status: 'pending' },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sale_edit_requests',
      entityId: request.id,
      action: 'create',
      after: { sale_id: id, fields: Object.keys(changes) },
    });
    const rep = await this.prisma.rep.findUnique({ where: { id: sale.rep_id }, select: { field_manager_id: true } });
    await this.notifyApprovers(rep?.field_manager_id ?? null, {
      eventType: 'sale_edit_requested',
      title: `Edit requested for sale ${sale.sale_code}`,
      body: `${user.full_name} asked to edit sale ${sale.sale_code}. Review the change before ${editWindowEndsOn(sale.created_at)}.`,
      relatedEntityType: 'sale_edit_requests',
      relatedEntityId: request.id,
      variables: { sale_code: sale.sale_code, requester_name: user.full_name, customer_name: sale.customer_name },
    });
    return (await this.presentEditRequests([request]))[0];
  }

  /** Edit requests, newest first, scoped to the sales the caller may see (§5). */
  async listEditRequests(query: ListSaleEditRequestsQuery, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    const and: Prisma.SaleEditRequestWhereInput[] = [];
    if (repIds !== null) and.push({ sale: { rep_id: { in: repIds } } });
    if (query.status) and.push({ status: query.status });
    if (query.search) {
      and.push({
        sale: {
          OR: [
            { sale_code: { contains: query.search, mode: 'insensitive' } },
            { customer_name: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      });
    }
    const where: Prisma.SaleEditRequestWhereInput = and.length ? { AND: and } : {};
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, ['created_at', 'status'] as const, { created_at: 'desc' });
    const [rows, total] = await Promise.all([
      this.prisma.saleEditRequest.findMany({ where, orderBy, skip, take }),
      this.prisma.saleEditRequest.count({ where }),
    ]);
    return buildPage(await this.presentEditRequests(rows), total, page, limit);
  }

  /** Apply a pending request through the edit path, in ONE transaction (window + status re-checked). */
  async approveEditRequest(requestId: string, note: string | undefined, user: AuthUser) {
    const { request, sale, changes } = await this.prisma.$transaction(async (tx) => {
      const request = await this.loadPendingRequest(tx, requestId);
      const sale = await this.loadScoped(request.sale_id, user, tx);
      const changes = request.changes as SaleChanges;
      await this.applyChanges(tx, sale, changes);
      const decided = await tx.saleEditRequest.update({
        where: { id: requestId },
        data: { status: 'approved', decided_by: user.id, decided_at: new Date(), note: note ?? null },
      });
      return { request: decided, sale, changes };
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sales',
      entityId: sale.id,
      action: 'update',
      before: this.pickBefore(sale, changes),
      after: { ...changes, edit_request_id: requestId } as Prisma.InputJsonValue,
    });
    await this.notifyEditDecided(request.requested_by, sale, 'approved', note);
    return (await this.presentEditRequests([request]))[0];
  }

  async rejectEditRequest(requestId: string, note: string | undefined, user: AuthUser) {
    const pending = await this.loadPendingRequest(this.prisma, requestId);
    const sale = await this.loadScoped(pending.sale_id, user); // scope check (§5)
    const request = await this.prisma.saleEditRequest.update({
      where: { id: requestId },
      data: { status: 'rejected', decided_by: user.id, decided_at: new Date(), note: note ?? null },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'sale_edit_requests',
      entityId: requestId,
      action: 'reject',
      after: { sale_id: sale.id, note: note ?? null },
    });
    await this.notifyEditDecided(request.requested_by, sale, 'rejected', note);
    return (await this.presentEditRequests([request]))[0];
  }

  private async loadPendingRequest(db: Prisma.TransactionClient | PrismaService, id: string) {
    const request = await db.saleEditRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Edit request not found');
    if (request.status !== 'pending') {
      throw new ConflictException(`this edit request was already ${request.status}`);
    }
    return request;
  }

  private async notifyEditDecided(
    requesterId: string,
    sale: { id: string; sale_code: string },
    decision: 'approved' | 'rejected',
    note: string | undefined,
  ): Promise<void> {
    try {
      await this.emitter.emitMany([requesterId], {
        eventType: 'sale_edit_decided',
        title: `Your edit to sale ${sale.sale_code} was ${decision}`,
        body: note ? `Your edit to sale ${sale.sale_code} was ${decision}. Note: ${note}` : `Your edit to sale ${sale.sale_code} was ${decision}.`,
        relatedEntityType: 'sales',
        relatedEntityId: sale.id,
        variables: { sale_code: sale.sale_code, decision, note: note ?? '' },
      });
    } catch {
      // best-effort
    }
  }

  /** Edit requests → the response shape, with names and a display diff (before = the sale's CURRENT value). */
  private async presentEditRequests(
    rows: Array<{
      id: string;
      sale_id: string;
      requested_by: string;
      changes: Prisma.JsonValue;
      status: string;
      note: string | null;
      decided_by: string | null;
      decided_at: Date | null;
      created_at: Date;
    }>,
  ) {
    if (rows.length === 0) return [];
    const sales = await this.prisma.sale.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.sale_id))] } },
      include: SALE_INCLUDE,
    });
    const saleById = new Map(sales.map((s) => [s.id, s]));
    const userIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    const productIds = [
      ...new Set(rows.flatMap((r) => ((r.changes as SaleChanges | null)?.items ?? []) as string[])),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const productName = new Map(products.map((p) => [p.id, p.name]));
    const today = todayInWinnipeg();

    return rows.map((r) => {
      const sale = saleById.get(r.sale_id);
      const changes = (r.changes ?? {}) as SaleChanges;
      const display = (key: string, value: unknown): string | null => {
        if (value === null || value === undefined) return null;
        if (key === 'is_greenfield') return value ? 'Yes' : 'No';
        if (key === 'items') return (value as string[]).map((id) => productName.get(id) ?? id).join(', ');
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        return String(value);
      };
      const diff = Object.entries(changes).map(([field, after]) => {
        let before: unknown = null;
        if (sale) {
          before =
            field === 'items'
              ? null
              : (sale as unknown as Record<string, unknown>)[field];
        }
        return {
          field,
          label: EDIT_LABELS[field] ?? field,
          before:
            field === 'items' && sale
              ? sale.sale_items.map((i) => i.product?.name ?? i.product_type).join(', ')
              : display(field, before),
          after: display(field, after),
        };
      });
      return {
        id: r.id,
        sale_id: r.sale_id,
        sale_code: sale?.sale_code ?? '',
        customer_name: sale?.customer_name ?? '',
        rep_name: sale?.rep?.full_name ?? null,
        requested_by: r.requested_by,
        requested_by_name: nameById.get(r.requested_by) ?? null,
        status: r.status,
        changes: changes as Record<string, unknown>,
        diff,
        note: r.note,
        decided_by: r.decided_by,
        decided_by_name: r.decided_by ? (nameById.get(r.decided_by) ?? null) : null,
        decided_at: r.decided_at,
        created_at: r.created_at,
        edit_window_ends_on: sale ? editWindowEndsOn(sale.created_at) : '',
        sale_editable: sale ? isSaleEditable(sale.status, sale.created_at, today) : false,
      };
    });
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
    // A possible duplicate is HELD: it may not be validated (and so never reaches a pay run) until an
    // admin/manager approves it. — client meeting 2026-11-16
    if (sale.duplicate_of_sale_id && !sale.duplicate_approved_at) {
      const original = await tx.sale.findUnique({ where: { id: sale.duplicate_of_sale_id }, select: { sale_code: true } });
      throw new DomainError(
        'SALE_DUPLICATE_UNAPPROVED',
        `Sale ${sale.sale_code} is a possible duplicate of ${original?.sale_code ?? 'another sale'}. Approve the duplicate before validating it.`,
        { duplicate_of_sale_id: sale.duplicate_of_sale_id },
      );
    }
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
    const personal = (await this.scope.getRepScope(user)).level === 'self';
    const where = await this.exportWhere(dto.filters ?? {}, dto.only_new ?? false, user, personal);
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
            personal,
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
      rows: await this.withClawbackTotals(await this.withEstimatedRates(await this.attachPeriods(rows))),
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

  /**
   * EXPORT ONLY (2026-11-15): the amount recovered from each sale by clawbacks (pending or applied), read
   * from the clawback records themselves (the frozen recovery, #6). The rate columns keep showing what was
   * paid, so this column is what makes the deduction visible in the file. null = nothing clawed back.
   */
  private async withClawbackTotals<T extends { id: string }>(sales: T[]): Promise<Array<T & { clawback_total: string | null }>> {
    const sums = await this.prisma.clawback.groupBy({
      by: ['sale_id'],
      where: { sale_id: { in: sales.map((s) => s.id) } },
      _sum: { amount: true },
    });
    const bySale = new Map(sums.map((r) => [r.sale_id, r._sum.amount]));
    return sales.map((s) => {
      const total = bySale.get(s.id);
      return { ...s, clawback_total: total ? new Prisma.Decimal(total).toFixed(2) : null };
    });
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

  private async exportWhere(
    filters: SaleExportFilters,
    onlyNew: boolean,
    user: AuthUser,
    personal = false,
  ): Promise<Prisma.SaleWhereInput> {
    const base = await this.listWhere(filters, user);
    // A deleted sale is not a sale: an export leaves it out unless the operator filtered FOR deleted sales.
    // (It used to ride along and was then logged as "exported", which skewed "only new".) 2026-11-15
    const live: Prisma.SaleWhereInput = filters.status ? base : { AND: [base, { status: { not: 'deleted' } }] };
    // "Not exported before" is company-wide: once anyone has exported a sale, it is no longer new. A rep's
    // own (PERSONAL) export is the exception (2026-11-28): it never hides a sale from anyone else, and a rep's
    // "only new" reads only their own exports.
    if (!onlyNew) return live;
    const earlier: Prisma.ReportExportWhereInput = personal ? { generated_by: user.id } : { personal: false };
    return { AND: [live, { export_links: { none: { report_export: earlier } } }] };
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

  /**
   * The response extras every sale read carries (2026-11-16): the original's Sale ID for a possible duplicate,
   * the edit window's last day, whether the sale is editable right now, and whether an edit request is
   * pending — so the UI does no date math. Two batch queries per response.
   */
  private async decorate<T extends { id: string; status: string; created_at: Date; duplicate_of_sale_id?: string | null }>(
    sales: T[],
  ): Promise<Array<T & { duplicate_of_sale_code: string | null; edit_window_ends_on: string; editable: boolean; has_pending_edit_request: boolean }>> {
    if (sales.length === 0) return [];
    const [codes, pending] = await Promise.all([
      this.saleCodesById(sales.map((s) => s.duplicate_of_sale_id ?? '')),
      this.prisma.saleEditRequest
        ? this.prisma.saleEditRequest.findMany({
            where: { sale_id: { in: sales.map((s) => s.id) }, status: 'pending' },
            select: { sale_id: true },
          })
        : Promise.resolve([] as { sale_id: string }[]),
    ]);
    const pendingSet = new Set(pending.map((p) => p.sale_id));
    const today = todayInWinnipeg();
    return sales.map((s) => ({
      ...s,
      duplicate_of_sale_code: s.duplicate_of_sale_id ? (codes.get(s.duplicate_of_sale_id) ?? null) : null,
      edit_window_ends_on: editWindowEndsOn(s.created_at),
      editable: isSaleEditable(s.status, s.created_at, today),
      has_pending_edit_request: pendingSet.has(s.id),
    }));
  }

  private async attachPeriods<
    T extends { id: string; status: string; created_at: Date; duplicate_of_sale_id?: string | null; sale_date: Date; rep_id: string; rep?: RepIdentity | null },
  >(sales: T[]) {
    const [periods, photos] = await Promise.all([
      this.prisma.payPeriod.findMany({
        select: { id: true, period_number: true, start_date: true, end_date: true },
      }),
      // The selling rep's photo (HR headshot), one batch per response. 2026-11-12
      this.avatars ? this.avatars.resolveReps(sales.map((s) => s.rep_id)) : Promise.resolve(new Map<string, string | null>()),
    ]);
    const decorated = await this.decorate(sales);
    return decorated.map((sale) => ({
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
