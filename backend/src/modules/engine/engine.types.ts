/**
 * Commission Engine — input/output types.
 *
 * The engine is PURE and ISOLATED: it imports NO @prisma/client, no DB, no HTTP. Money is
 * exact-decimal (`decimal.js` — never float). `ProductType` mirrors the Prisma enum's string
 * values 1:1 so the caller (Pay Run, later) maps directly without coupling the engine to Prisma.
 * — CLAUDE §3 #1, §6, arch §8
 */
import { Decimal } from 'decimal.js';

/**
 * The core product-type keys the engine BRANCHES on. `internet` is the only tiered type (#5) and
 * `greenfield_internet` is the only excluded-flat type (#9) — those two are locked. Other product types
 * (tv / home_phone / any SA-added standard add-on) are just keys into `flatRates`; the engine never
 * branches on them, so product types are now open strings everywhere except these two reserved names.
 */
export enum ProductType {
  internet = 'internet',
  greenfield_internet = 'greenfield_internet',
  tv = 'tv',
  home_phone = 'home_phone',
}

export type IncentiveTargetType = 'per_activation' | 'target_based';

/** One bracket of the effective tier schedule (Schedule C v2). tierNumber: 1 highest .. 4 entry. */
export interface TierBracket {
  tierNumber: number;
  minCount: number; // inclusive lower bound of the gross internet tally
  maxCount: number | null; // inclusive upper bound; null = no upper bound (36+)
  ratePerActivation: Decimal;
}

/**
 * Flat (non-tiered) product rates, keyed by product-type key. Greenfield internet is flat AND excluded
 * from the tally. A map (not a fixed trio) so SA-added types are looked up by key — an activation whose
 * type has no entry throws (the caller surfaces it as a 422 "no flat rate for <type>").
 */
export type FlatRates = Record<string, Decimal>;

/** The advance/holdback split (default 0.70 / 0.30). — SRS COMM-003 */
export interface HoldbackSplit {
  advancePct: Decimal;
  holdbackPct: Decimal;
}

/** An effective-dated incentive/spiff. Only `per_activation` is computed this pass. — SRS COMM-005 */
export interface IncentiveConfig {
  id: string;
  scopeClientId: string | null; // null = all clients
  scopeProductType: string | null; // product-type key; null = all product types
  targetType: IncentiveTargetType;
  targetCount: number | null;
  windowStart: string; // 'YYYY-MM-DD' inclusive
  windowEnd: string; // 'YYYY-MM-DD' inclusive
  amount: Decimal; // per-activation bonus
}

/** The effective configuration, passed IN (the engine never reads a database). */
export interface EngineConfig {
  tiers: TierBracket[];
  flatRates: FlatRates;
  holdback: HoldbackSplit;
  incentives?: IncentiveConfig[];
}

/** One activation (sale_item), already filtered to the period by the caller (sale_date governs). */
export interface ActivationInput {
  id: string; // sale_item id — echoed onto the output for mapping
  productType: string; // product-type key (only 'internet'/'greenfield_internet' are special)
  clientId: string; // used for incentive scope only — NOT for the tally (tally is cross-client)
  saleDate: string; // 'YYYY-MM-DD' — used for the incentive window only
}

export interface PeriodInput {
  activations: ActivationInput[];
  config: EngineConfig;
}

/** A computed per-item result. The snapshot fields are what Pay Run later freezes onto sale_items. */
export interface ComputedItem {
  id: string;
  productType: string;
  countsTowardTally: boolean; // true only for non-greenfield internet
  tierAtPayment: number | null; // internet only; null for flat-rated items
  rateApplied: Decimal; // tier rate (internet) or flat rate (others)
  commissionBase: Decimal; // rate only, NO incentive — part of the 70/30 base
  incentiveId: string | null;
  incentiveAmount: Decimal; // 0 if none
  commissionPaid: Decimal; // base + incentive — the SNAPSHOT value; equals the clawback amount
}

export interface PeriodResult {
  internetTally: number; // gross non-greenfield internet count, across ALL clients
  tierNumber: number | null; // null when the tally is 0
  ratePerActivation: Decimal | null;
  items: ComputedItem[];
  grossCommission: Decimal; // Σ commissionBase — the 70/30 base
  advanceAmount: Decimal; // 70% of gross (HALF_UP to cents)
  holdbackAmount: Decimal; // gross − advance (so advance + holdback === gross exactly)
  incentiveTotal: Decimal; // Σ incentiveAmount — paid in full, NOT subject to the split
  totalEarned: Decimal; // gross + incentiveTotal (informational)
}

/** The frozen snapshot a clawback reads. — SRS CLAW-001/005 */
export interface ClawbackSnapshot {
  rateApplied: Decimal;
  incentiveAmount?: Decimal | null;
}
