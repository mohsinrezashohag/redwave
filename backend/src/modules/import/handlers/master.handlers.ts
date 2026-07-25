/**
 * Commit handlers for the go-live MASTER imports — clients, products (+ optional inline billing rate),
 * reps, and HISTORICAL sales. Each runs inside the batch's `prisma.$transaction` (atomic, #8) and resolves
 * friendly codes → ids within the tx. Money is an exact decimal STRING → Prisma Decimal (never float, #1).
 *
 * HISTORICAL sales (DOC of the §17 confirmed rule): inserted `status='historical'` — reference-only. They
 * NEVER enter the pay pipeline (snapshots stay NULL, `counts_toward_tally=false`), and the only financial
 * figure stored is `sale_items.historical_billed_amount` (a billing-stream reference, not commission, #3).
 */
import { Prisma } from '@prisma/client';
import { DomainError } from '../../../common/errors/domain-error';
import { dateOnly } from '../../../common/effective-dating';
import { saleCodeBase, withSuffix } from '../../sales/sale-id.logic';
import { isTrue, normCode } from '../clean.logic';
import { RawRow } from '../mapping.logic';
import { splitProductTypes } from '../matching.logic';

const text = (row: RawRow, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === '' ? null : String(v);
};
const market = (v: unknown): 'CA' | 'US' => (String(v ?? '').toUpperCase() === 'US' ? 'US' : 'CA');

// ── Clients (upsert by code) ──────────────────────────────────────────────────────
export async function applyClient(tx: Prisma.TransactionClient, mapped: RawRow): Promise<string> {
  const code = normCode(mapped.client_code)!;
  const data = { name: String(mapped.name), market: market(mapped.market), supplies_mpu_id: isTrue(mapped.supplies_mpu_id) };
  const existing = await tx.client.findUnique({ where: { client_code: code }, select: { id: true } });
  if (existing) {
    await tx.client.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await tx.client.create({ data: { client_code: code, is_active: true, ...data } });
  return created.id;
}

// ── Products (+ optional inline CLIENT billing rate) ──────────────────────────────
export async function applyProduct(tx: Prisma.TransactionClient, mapped: RawRow, createdBy: string): Promise<string> {
  const code = normCode(mapped.client_code)!;
  const client = await tx.client.findUnique({ where: { client_code: code }, select: { id: true } });
  if (!client) throw new DomainError('IMPORT_CLIENT_NOT_FOUND', `client ${code} not found`);
  const product = await tx.product.create({
    data: { client_id: client.id, name: String(mapped.name), product_type: String(mapped.product_type), is_active: true },
  });
  const amount = text(mapped, 'billing_amount');
  if (amount) {
    await tx.clientBillingRate.create({
      data: {
        client_id: client.id,
        product_id: product.id,
        rate_kind: 'product',
        amount, // decimal string → Prisma Decimal (#1)
        effective_from: dateOnly(String(mapped.effective_from)),
        effective_to: null,
        created_by: createdBy,
      },
    });
  }
  return product.id;
}

// ── Reps (created; rep_code never reused, #11 — the classifier rejects an existing code) ──
export async function applyRep(tx: Prisma.TransactionClient, mapped: RawRow, importerUserId: string): Promise<string> {
  const code = normCode(mapped.rep_code)!;
  const rep = await tx.rep.create({
    data: {
      rep_code: code,
      // Already UPPER-cased by the `code` field type — the same fold the import lookup uses.
      external_code: text(mapped, 'external_code'),
      full_name: String(mapped.full_name),
      hire_date: dateOnly(String(mapped.hire_date)),
      // The importing admin is the default field manager; reassign in HRM after go-live.
      field_manager_id: importerUserId,
      status: text(mapped, 'status') === 'terminated' ? 'terminated' : 'active',
    },
  });
  return rep.id;
}

/**
 * Find a rep by EITHER its system `rep_code` or its optional `external_code` — Redwave's own files call a
 * rep "Redwave20" while the system knows them as "RW-D-0001". Shared by the commit handlers so a file may
 * mix both schemes. Codes arrive already UPPER-cased by `normCode`.
 */
export async function findRepByAnyCode(tx: Prisma.TransactionClient, code: string): Promise<{ id: string } | null> {
  return tx.rep.findFirst({
    where: { OR: [{ rep_code: code }, { external_code: code }] },
    select: { id: true },
  });
}

// ── Historical sales: resolving (and optionally CREATING) the records a row references ────────────
export interface HistoricalSaleOptions {
  /** The operator opted in via `create_missing`; the preview listed exactly what this would create. */
  createMissing?: boolean;
  /** Becomes the created rep's field manager, mirroring `applyRep`. */
  importerUserId?: string;
}

/**
 * Records auto-created by an import are deliberately MINIMAL and obviously provisional. A historical sales
 * row carries only a code — no client name, no rep hire date — so anything else would be invented. Naming
 * them after their own code makes them easy to find and complete in Clients / HRM afterwards, and none of
 * them is given a billing rate or any money field (#3): they exist purely so reference-only history has
 * something to point at.
 */
async function resolveClient(tx: Prisma.TransactionClient, clientCode: string, opts: HistoricalSaleOptions) {
  const existing = await tx.client.findUnique({ where: { client_code: clientCode }, select: { id: true, client_code: true } });
  if (existing) return existing;
  if (!opts.createMissing) throw new DomainError('IMPORT_CLIENT_NOT_FOUND', `client ${clientCode} not found`);
  return tx.client.create({
    data: { client_code: clientCode, name: clientCode, market: 'CA', supplies_mpu_id: false, is_active: true },
    select: { id: true, client_code: true },
  });
}

async function resolveRep(tx: Prisma.TransactionClient, repCode: string, saleDate: string, opts: HistoricalSaleOptions) {
  const existing = await findRepByAnyCode(tx, repCode);
  if (existing) return existing;
  if (!opts.createMissing) throw new DomainError('IMPORT_REP_NOT_FOUND', `rep ${repCode} not found`);
  if (!opts.importerUserId) {
    throw new DomainError('IMPORT_REP_MANAGER_MISSING', 'cannot create a rep without an importing user');
  }
  // The row's own sale_date is the only defensible hire date available — they demonstrably sold on it.
  // Codes are never reused (#11), and the classifier only reaches here when the code is genuinely absent.
  return tx.rep.create({
    data: { rep_code: repCode, full_name: repCode, hire_date: dateOnly(saleDate), field_manager_id: opts.importerUserId, status: 'active' },
    select: { id: true },
  });
}

async function resolveProduct(
  tx: Prisma.TransactionClient,
  clientId: string,
  clientCode: string,
  productType: string,
  opts: HistoricalSaleOptions,
) {
  const existing = await tx.product.findFirst({
    where: { client_id: clientId, product_type: productType, is_active: true },
    select: { id: true },
  });
  if (existing) return existing;
  if (!opts.createMissing) {
    throw new DomainError('IMPORT_PRODUCT_NOT_FOUND', `no ${productType} product for client ${clientCode}`);
  }
  // NO client_billing_rate is created — the two rate streams stay separate (#3), and a rate is a priced
  // business decision an import must never make on the operator's behalf.
  return tx.product.create({
    data: { client_id: clientId, name: `${productType} (imported)`, product_type: productType, is_active: true },
    select: { id: true },
  });
}

// ── Historical sales (reference-only — NEVER paid; business aggregation only) ──────
/**
 * ONE ROW = ONE HOUSEHOLD → one sale with N `sale_items`, because a real migration file writes
 * "Internet, TV, Home Phone" in a single Product type cell (see `docs/uat/Sales Upload.xlsx`).
 *
 * MONEY RULE (#1/#3): the row's `billed_amount` is ONE figure for the whole household, so it is recorded
 * exactly ONCE — on the base item (the tiered/greenfield one, else the first) — and every other item's
 * `historical_billed_amount` stays NULL. It is never divided: splitting would invent an attribution the
 * source file never stated and could not round cleanly ($350 over 3 items). This keeps
 * `Σ historical_billed_amount` equal to the file's own column total, which is exactly what the Business
 * dashboard sums.
 */
export async function applyHistoricalSale(
  tx: Prisma.TransactionClient,
  mapped: RawRow,
  batchId: string,
  /** Catalogue behaviour per type key, so the base item can be identified without re-querying. */
  behaviours: Map<string, string>,
  opts: HistoricalSaleOptions = {},
): Promise<string> {
  const clientCode = normCode(mapped.client_code)!;
  const client = await resolveClient(tx, clientCode, opts);
  const repCode = normCode(mapped.rep_code)!;
  const rep = await resolveRep(tx, repCode, String(mapped.sale_date), opts);

  // The classifier already resolved + proved these, so a miss here is a genuine race and correctly rolls
  // the whole batch back (#8).
  const productTypes = splitProductTypes(text(mapped, 'product_types'));
  if (productTypes.length === 0) {
    throw new DomainError('IMPORT_PRODUCT_TYPE_MISSING', 'the row names no product type');
  }
  const items: { productId: string; productType: string }[] = [];
  for (const productType of productTypes) {
    const product = await resolveProduct(tx, client.id, clientCode, productType, opts);
    items.push({ productId: product.id, productType });
  }

  // The base item carries the household's billed amount — see the MONEY RULE above.
  const baseIndex = items.findIndex((i) => {
    const behaviour = behaviours.get(i.productType);
    return behaviour === 'tiered' || behaviour === 'greenfield';
  });
  const billedOn = baseIndex >= 0 ? baseIndex : 0;

  const saleDate = String(mapped.sale_date);
  const mpuId = text(mapped, 'mpu_id');
  const base = saleCodeBase({ saleDate, clientCode: client.client_code, mpuId });
  const existingCount = await tx.sale.count({ where: { sale_code: { startsWith: base } } });
  const sale = await tx.sale.create({
    data: {
      sale_code: withSuffix(base, existingCount),
      sale_date: dateOnly(saleDate),
      activation_date: mapped.activation_date ? dateOnly(String(mapped.activation_date)) : null,
      rep_id: rep.id,
      client_id: client.id,
      customer_name: text(mapped, 'customer_name') ?? 'Migrated',
      street: '—',
      city: '—',
      province_state: '—',
      postal_code: '—',
      mpu_id: mpuId,
      is_greenfield: isTrue(mapped.is_greenfield),
      status: 'historical', // reference-only — never validated/paid (#2/#5 preserved: engine never sees it)
      import_batch_id: batchId,
      sale_items: {
        create: items.map((item, index) => ({
          product_id: item.productId,
          product_type: item.productType, // snapshot
          counts_toward_tally: false, // historical never counts toward a tier tally (#5/#9)
          // commission snapshots stay NULL — historical is NOT a commission record (#2)
          historical_billed_amount: index === billedOn ? String(mapped.billed_amount) : null, // (#3)
          item_status: 'active',
        })),
      },
    },
  });
  return sale.id;
}
