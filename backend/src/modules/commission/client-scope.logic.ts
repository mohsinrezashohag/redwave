/**
 * Client-scoped commission config resolution — PURE & deterministic (no I/O, no Prisma, no NestJS).
 *
 * Commission tier schedules and flat rates are effective-dated AND optionally scoped to one client, with
 * the GLOBAL row (client_id === null) as the fallback. Precedence for one date, generalising the km-rate
 * pattern (`expenses/km-rate.logic.ts#selectKmRate`):
 *   1. the client-specific row in force on the date, else
 *   2. the GLOBAL row in force on the date, else
 *   3. null → the caller decides (422 for a missing tier schedule, "no flat rate" for a sold type).
 *
 * This is the REP-commission stream only — nothing here reads client_billing_rates (#3). Scoping the RATE
 * by client never scopes the internet TALLY, which stays cross-client (#5).
 * — CLAUDE §3 #3/#5/#10
 */
import { RateRow, selectEffectiveRate } from '../../common/effective-dating';

/** Sentinel for the global bucket. Rows loaded from Prisma have `client_id: null`; test doubles often omit
 *  the field entirely, so `?? GLOBAL` (never `=== null`) is what keeps the global row from being dropped. */
export const GLOBAL_SCOPE = 'GLOBAL';

/** The literal a list query passes to ask for the global rows specifically. */
export const GLOBAL_FILTER = 'global';

/**
 * Prisma `where` fragment for a list scope filter:
 *   undefined → every scope · 'global' → the global rows (client_id IS NULL) · else that client.
 */
export const scopeWhere = (clientId?: string): { client_id?: string | null } =>
  clientId === undefined ? {} : { client_id: clientId === GLOBAL_FILTER ? null : clientId };

export interface ClientScopedRow extends RateRow {
  client_id?: string | null;
}

/** The scope bucket key for a row: its client id, or the global sentinel. */
export const scopeKeyOf = (row: ClientScopedRow): string => row.client_id ?? GLOBAL_SCOPE;

/**
 * The row in force for (clientId, date) — client-specific first, then the global fallback. `clientId` may
 * be null/undefined to ask for the global row directly.
 */
export function selectForClient<T extends ClientScopedRow>(
  rows: T[],
  clientId: string | null | undefined,
  date: Date,
): T | null {
  if (clientId) {
    const clientPick = selectEffectiveRate(
      rows.filter((r) => r.client_id === clientId),
      date,
    );
    if (clientPick) return clientPick;
  }
  return selectEffectiveRate(
    rows.filter((r) => scopeKeyOf(r) === GLOBAL_SCOPE),
    date,
  );
}

/**
 * Group rows into scope buckets (client id or GLOBAL), then pick the row in force on `date` for EACH.
 *
 * This exists because `selectEffectiveRate` returns the latest effective_from from whatever array it is
 * handed: passing a mixed-scope list would let one client's newer row masquerade as everyone's. Callers
 * MUST group before selecting.
 */
export function selectEffectiveByScope<T extends ClientScopedRow>(
  rows: T[],
  date: Date,
): Map<string, T> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = scopeKeyOf(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const effective = new Map<string, T>();
  for (const [key, bucket] of buckets) {
    const pick = selectEffectiveRate(bucket, date);
    if (pick) effective.set(key, pick);
  }
  return effective;
}
