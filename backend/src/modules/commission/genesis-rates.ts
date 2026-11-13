/**
 * Genesis rep rates — the default rate per product type a fresh system starts with.
 *
 * Single source of truth shared by the SEED (writes these as the initial effective-dated rates) and the
 * engine-input-provider END-TO-END TEST. No tiers and no split since 2026-11-13: every sale item pays ONE
 * flat rate (a product's own rate, else its type's). All money is an exact decimal STRING (never float, #1).
 */
export const GENESIS_RATES = {
  /** Genesis effective date — back-dated so the rates are always "current" (seed-only, not a change). */
  effectiveFrom: '2024-01-01',

  /** Default rep rate per product type. Products and clients can override these in Commission Config. */
  rates: {
    internet: '110.00',
    greenfield_internet: '100.00',
    tv: '30.00',
    home_phone: '30.00',
  },
} as const;
