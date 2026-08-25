/**
 * Back-dated COMMISSION-CONFIG commit handlers (master_migration + commission_tiers / commission_flat_rates).
 * Writes `commission_tier_configs` + `commission_tiers` and `commission_flat_rates` DIRECTLY via the
 * transaction — the sanctioned #10 migration path, which deliberately bypasses the commission services'
 * back-date rejection (`effective-dates.util.ts`, 422). That guard is untouched: this is a second, AUDITED
 * way in, not a relaxation of the first.
 *
 * This is the REP stream. Nothing here reads or writes `client_billing_rates` (#3) — a client-scoped tier
 * schedule or flat rate scopes only the RATE LOOKUP; the internet tally stays cross-client (#5), which is
 * the engine's business and not this file's. A blank `client_code` is the GLOBAL row every client without
 * its own falls back to.
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
import { parseTierSpec } from '../tier-spec.logic';

/** Resolve the OPTIONAL client scope. Blank → null → the global row. */
async function resolveScope(tx: Prisma.TransactionClient, raw: unknown): Promise<string | null> {
  const code = normCode(raw);
  if (!code) return null;
  const client = await tx.client.findUnique({ where: { client_code: code }, select: { id: true } });
  if (!client) throw new DomainError('IMPORT_CLIENT_NOT_FOUND', `client ${code} not found`);
  return client.id;
}

/**
 * One row = one WHOLE schedule: the config row plus every bracket, created together so a schedule is never
 * half-written. The `tiers` cell was already parsed + contiguity-checked at classify time (the gate blocks
 * the batch on a bad one); re-parsing here keeps the handler correct on its own rather than trusting an
 * upstream step.
 */
export async function applyCommissionTierSchedule(
  tx: Prisma.TransactionClient,
  mapped: RawRow,
  createdBy: string,
): Promise<string> {
  const clientId = await resolveScope(tx, mapped.client_code);
  const brackets = parseTierSpec(String(mapped.tiers));

  const config = await tx.commissionTierConfig.create({
    data: {
      client_id: clientId, // null = the GLOBAL schedule
      effective_from: dateOnly(String(mapped.effective_from)), // back-dated allowed here (#10)
      effective_to: mapped.effective_to ? dateOnly(String(mapped.effective_to)) : null,
      created_by: createdBy,
      tiers: {
        create: brackets.map((b) => ({
          tier_number: b.tier_number,
          min_count: b.min_count,
          max_count: b.max_count,
          rate_per_activation: b.rate_per_activation, // decimal string → Prisma Decimal (#1)
        })),
      },
    },
  });
  return config.id;
}

/** One row = one flat rate for one product type, on the global scope or one client's. */
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
      client_id: clientId, // null = the GLOBAL flat rate for this type
      product_type: productType,
      amount: String(mapped.amount), // decimal string → Prisma Decimal (never float, #1)
      effective_from: dateOnly(String(mapped.effective_from)), // back-dated allowed here (#10)
      effective_to: mapped.effective_to ? dateOnly(String(mapped.effective_to)) : null,
      created_by: createdBy,
    },
  });
  return row.id;
}
