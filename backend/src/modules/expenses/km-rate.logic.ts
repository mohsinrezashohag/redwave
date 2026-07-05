/**
 * Kilometre-rate resolution — PURE & deterministic (no I/O, no Prisma, no NestJS).
 *
 * The per-km reimbursement rate is per-client and effective-dated (Meeting 3, EXP-004). Resolution
 * precedence for one date:
 *   1. the client-specific rate in force on the date (client_id === the sale's client), else
 *   2. the GLOBAL rate in force on the date (client_id === null), else
 *   3. null → the caller applies the DEFAULT_RATE_PER_KM constant ($0.45).
 * "In force on the date" reuses the shared selectEffectiveRate (latest effective_from ≤ date whose
 * effective_to is null/≥ date). This is the REP stream only (#3); client_bill is resolved separately.
 * — SRS EXP-004 / CLAUDE §3 #3 / #10
 */
import { RateRow, selectEffectiveRate } from '../../common/effective-dating';

export interface KmRateRow extends RateRow {
  client_id: string | null;
  /** Exact-decimal rate string ($/km); the service wraps it in Decimal at the boundary (#1). */
  rate_per_km: string;
}

/**
 * The rep-reimbursement rate string in force for (clientId, date), client-specific first then global.
 * Returns null when neither scope has a row → the caller falls back to the default constant.
 */
export function selectKmRate(rows: KmRateRow[], clientId: string | null, date: Date): string | null {
  if (clientId) {
    const clientPick = selectEffectiveRate(
      rows.filter((r) => r.client_id === clientId),
      date,
    );
    if (clientPick) return clientPick.rate_per_km;
  }
  const globalPick = selectEffectiveRate(
    rows.filter((r) => r.client_id === null),
    date,
  );
  return globalPick ? globalPick.rate_per_km : null;
}
