/**
 * tierMode — is a scope (Global or one client) on a TIER LADDER or on BASE PRICES? Pure.
 * — client request 2026-11-11 ("tiers off": each product its own base price)
 *
 * There is no stored flag: BASE PRICES is simply a current schedule with ONE bracket covering every count
 * ([0, ∞), tier 1) — exactly what the engine pays as "the same price whatever the volume". A client with no
 * schedule of its own FOLLOWS Global, as the engine does. The server's `status` decides what is current; no
 * client-side date math (§13.10).
 */
import type { TierConfig } from './commission.types';

export type TierMode = 'tiers' | 'base_prices';

export interface ScopeTierMode {
  /** null when no schedule is in force at all (nothing to show yet). */
  mode: TierMode | null;
  /** The schedule in force for this scope (its own, or Global's when inherited). */
  current: TierConfig | null;
  /** A client following the Global setting because it has no schedule of its own in force. */
  inherited: boolean;
}

export function isBasePriceSchedule(c: Pick<TierConfig, 'tiers'>): boolean {
  return c.tiers.length === 1 && c.tiers[0].min_count === 0 && c.tiers[0].max_count === null;
}

const currentOf = (rows: TierConfig[] | undefined) => rows?.find((r) => r.status === 'current') ?? null;

export function deriveTierMode(
  isClientScope: boolean,
  scopeRows: TierConfig[] | undefined,
  globalRows: TierConfig[] | undefined,
): ScopeTierMode {
  const own = currentOf(scopeRows);
  const current = own ?? (isClientScope ? currentOf(globalRows) : null);
  return {
    mode: current ? (isBasePriceSchedule(current) ? 'base_prices' : 'tiers') : null,
    current,
    inherited: isClientScope && !own && !!current,
  };
}
