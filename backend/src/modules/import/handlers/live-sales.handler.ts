/**
 * LIVE sales commit handler (sales_entry + sales). DRIVES the Sales module's `createWithinTx` — and, when
 * the row says so, `validateWithinTx` — inside the import's transaction. It NEVER reimplements sale entry:
 * the rep/client/product checks, the mandatory internet base (SALE-001a), the Sale ID and
 * `counts_toward_tally` all live in SalesService. — SRS §15 (IMP-013), SALE-001/001a/005
 *
 * Unlike the HISTORICAL target these are real sales that DO flow into tier / pay run / clawback. No
 * commission is written here: `sale_items` snapshots stay NULL until Pay Run freezes them (#2/#5).
 */
import { foldName } from '../product-name.logic';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../../common/rbac/auth-user.type';
import { DomainError } from '../../../common/errors/domain-error';
import { SalesService } from '../../sales/sales.service';
import { isTrue, normCode } from '../clean.logic';
import { RawRow } from '../mapping.logic';
import { splitProductTypes } from '../matching.logic';
import { findRepByAnyCode } from './master.handlers';
import { normaliseRegionLenient, splitCityRegion } from '../../../common/geo/regions';

const text = (row: RawRow, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === '' ? null : String(v);
};
/** Address columns are optional on this target — a blank becomes the same placeholder history uses. */
const addr = (row: RawRow, key: string): string => text(row, key) ?? '—';

export async function applyLiveSale(
  tx: Prisma.TransactionClient,
  mapped: RawRow,
  user: AuthUser,
  sales: SalesService,
  batchId: string,
): Promise<string> {
  // Resolve the friendly codes → ids inside the tx. The classifier already proved these exist, so a miss
  // here is a genuine race/data change and correctly rolls the whole batch back.
  const clientCode = normCode(mapped.client_code)!;
  const client = await tx.client.findUnique({
    where: { client_code: clientCode },
    select: { id: true },
  });
  if (!client) throw new DomainError('IMPORT_CLIENT_NOT_FOUND', `client ${clientCode} not found`);

  const repCode = normCode(mapped.rep_code)!;
  // Either the system rep_code or the legacy external_code — the classifier already proved one resolves.
  const rep = await findRepByAnyCode(tx, repCode);
  if (!rep) throw new DomainError('IMPORT_REP_NOT_FOUND', `rep ${repCode} not found`);

  // One row = one sale; `product_types` is the (comma-separated) list of items on it.
  // A named product (the bill sheet's plan, e.g. "Fibre 1gig/2.5gig") is used for ITS type, so the right
  // per-product billing / rep rate applies; any other type takes the client's first active product of that
  // type, as before. The classifier already proved the name resolves. — 2026-11-28
  const wanted = foldName(text(mapped, 'product_name'));
  const named = wanted
    ? (
        await tx.product.findMany({
          where: { client_id: client.id, is_active: true },
          select: { id: true, product_type: true, name: true },
        })
      ).find((p) => foldName(p.name) === wanted)
    : undefined;
  const productIds: string[] = [];
  for (const productType of splitProductTypes(text(mapped, 'product_types'))) {
    const product =
      named && named.product_type === productType
        ? named
        : await tx.product.findFirst({
            where: { client_id: client.id, product_type: productType, is_active: true },
            select: { id: true },
          });
    if (!product) {
      throw new DomainError(
        'IMPORT_PRODUCT_NOT_FOUND',
        `no active ${productType} product for client ${clientCode}`,
      );
    }
    productIds.push(product.id);
  }

  // SalesService owns every entry rule (incl. SALE-001a and the Sale ID) — we only supply the DTO.
  const cityPart = splitCityRegion(text(mapped, 'city') ?? null, text(mapped, 'province_state') ?? null);
  const sale = await sales.createWithinTx(
    tx,
    {
      client_id: client.id,
      rep_id: rep.id,
      sale_date: String(mapped.sale_date),
      activation_date: text(mapped, 'activation_date') ?? undefined,
      // Blank when the file carries only first + last name: SalesService derives the name from the pair.
      customer_name: text(mapped, 'customer_name') ?? '',
      // Optional on this target: supplied together they DERIVE the customer name (SalesService owns that
      // rule), so a file with separate name columns needs no pre-joining.
      customer_first_name: text(mapped, 'customer_first_name') ?? undefined,
      customer_last_name: text(mapped, 'customer_last_name') ?? undefined,
      street: addr(mapped, 'street'),
      // A city cell like "Edmonton, AB" keeps only the city; the province it named fills a blank province. 2026-11-18
      city: cityPart.city ?? addr(mapped, 'city'),
      // Lenient (2026-11-16): a code or full name becomes the code; anything else is kept as written.
      province_state: normaliseRegionLenient(text(mapped, 'province_state')) ?? cityPart.region ?? '—',
      postal_code: addr(mapped, 'postal_code'),
      mpu_id: text(mapped, 'mpu_id') ?? undefined,
      is_greenfield: isTrue(mapped.is_greenfield),
      items: productIds.map((product_id) => ({ product_id })),
    },
    user,
    { importBatchId: batchId }, // provenance (IMP-008)
  );

  // Since 2026-11-28 a clean sale is created already validated (no per-sale validation step), so the row's
  // "status" column no longer changes anything for it. A flagged possible duplicate is created HELD and is
  // never validated here (it would roll the whole batch back); an approver reviews it. The guard on
  // 'entered' keeps this step a no-op instead of a 409 on an already-validated sale.
  if ((text(mapped, 'status') ?? 'entered').toLowerCase() === 'validated' && !sale.duplicate_of_sale_id && sale.status === 'entered') {
    await sales.validateWithinTx(tx, sale.id, {}, user);
  }
  return sale.id;
}
