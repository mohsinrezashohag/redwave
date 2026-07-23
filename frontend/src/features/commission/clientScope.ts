/**
 * Client scope for the effective-dated COMMISSION rates (tier schedules + flat rates). A rate row is either
 * GLOBAL (`client_id` null — the fallback every client inherits) or scoped to one client. The two are
 * INDEPENDENT effective-dated streams: adding a client rate never supersedes or bounds the global one.
 *
 * NOT a #3 violation — this is still the rep-commission stream, scoped BY client (the same shape as
 * `incentives.scope_client_id` and the km-rate config). Nothing here reads `client_billing_rates`.
 *
 * The engine resolves at runtime: the client's rate if one is in force on the sale date, else the global.
 * The internet TALLY stays cross-client (#5) — per-client means a per-client RATE, never a per-client tally.
 */

/** No filter — list every scope (the default admin view). */
export const SCOPE_ALL = '__all__';
/** The server's literal filter for the global fallback row (`client_id` null). */
export const SCOPE_GLOBAL = 'global';

/** Radix Select forbids an empty value, so the page uses sentinels; the API takes `undefined` for "all". */
export type ScopeValue = typeof SCOPE_ALL | typeof SCOPE_GLOBAL | (string & {});

/** Page selector value → the `client_id` query param (`undefined` = every scope). */
export const scopeParam = (scope: ScopeValue): string | undefined =>
  scope === SCOPE_ALL ? undefined : scope;

/** Page selector value → the `client_id` a NEW row should default to (`undefined` = global). */
export const scopeDefaultClientId = (scope: ScopeValue): string | undefined =>
  scope === SCOPE_ALL || scope === SCOPE_GLOBAL ? undefined : scope;

/**
 * Label a row's scope. `null` is the global fallback; an id the caller can't resolve (no `clients:view`,
 * or a since-deactivated client) degrades to a neutral placeholder rather than leaking the raw id.
 */
export function scopeLabel(
  clientId: string | null | undefined,
  clients: Array<{ id: string; name: string; client_code: string }> | undefined,
): string {
  if (!clientId) return 'All clients (global)';
  const c = clients?.find((x) => x.id === clientId);
  return c ? `${c.name} (${c.client_code})` : 'A client';
}
