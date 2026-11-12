/**
 * Schedule C v2 — the genesis commission configuration (SRS §7.2).
 *
 * Single source of truth shared by the SEED (writes these as the initial effective-dated config) and
 * the engine-input-provider END-TO-END TEST (feeds these through provider → engine → $3,310). All
 * money/pct are exact decimal STRINGS (never float, #1).
 */
export const SCHEDULE_C_V2 = {
  /** Genesis effective date — back-dated so the config is always "current" (seed-only, not a change). */
  effectiveFrom: '2024-01-01',

  /** Tier schedule: tier 1 highest .. tier 4 entry. */
  tiers: [
    { tier_number: 4, min_count: 0, max_count: 6, rate_per_activation: '110.00' },
    { tier_number: 3, min_count: 7, max_count: 16, rate_per_activation: '125.00' },
    { tier_number: 2, min_count: 17, max_count: 35, rate_per_activation: '145.00' },
    { tier_number: 1, min_count: 36, max_count: null, rate_per_activation: '160.00' },
  ] as const,

  /** Flat (non-tiered) product rates. internet is tiered, so it has no flat rate. */
  flatRates: {
    greenfield_internet: '100.00',
    tv: '30.00',
    home_phone: '30.00',
  },

  // No advance/holdback split: commission is paid in full since 2026-11-13 (NO_HOLDBACK in the provider).
} as const;
