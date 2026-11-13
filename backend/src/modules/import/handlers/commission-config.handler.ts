/**
 * Back-dated REP-RATE commit handler (master_migration + commission_flat_rates). No tiers since 2026-11-13.
 * Writes `commission_flat_rates` DIRECTLY via the
 * transaction — the sanctioned #10 migration path, which deliberately bypasses the commission services'
 * back-date rejection (`effective-dates.util.ts`, 422). That guard is untouched: this is a second, AUDITED
 * way in, not a relaxation of the first.
 *
 * This is the REP stream. Nothing here reads or writes `client_billing_rates` (#3). A blank `client_code`
 * is the GLOBAL row every client without its own falls back to.
 *
 * Rates are inserted VERBATIM (the import is the authoritative historical record): no supersession is
 * planned and no existing row is bounded, because the file states what was actually in force and
 * `selectEffectiveRate` reads it back by date.
 *
 * Money is an exact decimal STRING → Prisma Decimal, never parseFloat (#1).
 * — docs/claude-code/04-backdate-import.md, CLAUDE §3 #10, SRS COMM-001/COMM-002
 */
import { Prisma } from '@prisma/client';
import { DomainError } from '../../../common/errors/domain-error';
import { dateOnly } from '../../../common/effective-dating';
import { normCode } from '../clean.logic';
import { RawRow } from '../mapping.logic';

/** Resolve the OPTIONAL client scope. Blank → null → the global row. */
async function resolveScope(tx: Prisma.TransactionClient, raw: unknown): Promise<string | null> {
  const code = normCode(raw);
  if (!code) return null;
  const client = await tx.client.findUnique({ where: { client_code: code }, select: { id: true } });
  if (!client) throw new DomainError('IMPORT_CLIENT_NOT_FOUND', `client ${code} not found`);
  return client.id;
}

/** One row = one rep rate for one product type, on the global scope or one client's. */
export async function applyCommissionFlatRate(
  tx: Prisma.TransactionClient,
  mapped: RawRow,
  createdBy: string,
): Promise<string> {
  const clientId = await resolveScope(tx, mapped.client_code);
  const productType = String(mapped.product_type);

  // The catalogue is SA-governed config — an import resolves against it and never invents a type (§14 #7).
  const type = await tx.productTypeCatalogue.findUnique({ where: { key: productType }, select: { key: true } });
  if (!type) {
    throw new DomainError('IMPORT_PRODUCT_TYPE_NOT_FOUND', `product type "${productType}" is not in the catalogue`);
  }

  const row = await tx.commissionFlatRate.create({
    data: {
      client_id: clientId, // null = the GLOBAL rate for this type
      product_type: productType,
      amount: String(mapped.amount), // decimal string → Prisma Decimal (never float, #1)
      effective_from: dateOnly(String(mapped.effective_from)), // back-dated allowed here (#10)
      effective_to: mapped.effective_to ? dateOnly(String(mapped.effective_to)) : null,
      created_by: createdBy,
    },
  });
  return row.id;
}
