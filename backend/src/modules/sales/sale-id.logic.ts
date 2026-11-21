/**
 * Pure composite Sale ID logic — no I/O, deterministic, fully unit-testable.
 *
 * Sale ID = sale_date + MPU ID (when present) + client; a duplicate (same base) gets a -1/-2 suffix.
 * The suffix only keeps `sale_code` unique. A second live sale with the same client + MPU is not blocked
 * here either: SalesService creates it FLAGGED as a possible duplicate (`duplicate_of_sale_id`), held for
 * an admin/manager to approve before it can be validated (client meeting 2026-11-16).
 * MPU ID may be absent (e.g. RF Now) → the base composes without it. — SRS SALE-002/003
 */
export interface SaleCodeParts {
  saleDate: string; // 'YYYY-MM-DD'
  clientCode: string;
  mpuId?: string | null;
}

/** The base code (no suffix): sale_date + mpu (if present) + client, joined by '-'. */
export function saleCodeBase(parts: SaleCodeParts): string {
  return [parts.saleDate, parts.mpuId, parts.clientCode]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('-');
}

/**
 * Apply the duplicate suffix: the first sale for a base keeps the base; the Nth duplicate
 * (existingCount = N already present) becomes `base-N` (1st dup → `-1`, 2nd → `-2`).
 */
export function withSuffix(base: string, existingCount: number): string {
  return existingCount <= 0 ? base : `${base}-${existingCount}`;
}
