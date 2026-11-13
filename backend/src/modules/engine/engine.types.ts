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
 * The product-type keys the engine knows by name. Only `greenfield_internet` is special: a greenfield
 * internet sale is paid the greenfield rate, never the internet product's own rate. Every other type
 * (internet / tv / home_phone / any SA-added add-on) is just a key into the flat rate maps.
 */
export enum ProductType {
  internet = 'internet',
  greenfield_internet = 'greenfield_internet',
  tv = 'tv',
  home_phone = 'home_phone',
}

export type IncentiveTargetType = 'per_activation' | 'one_time';

/**
 * Rep rates keyed by product-type key. A map (not a fixed set) so SA-added types are looked up by key; an
 * activation with no rate anywhere throws (the caller surfaces it as a 422 naming the product type).
 */
export type FlatRates = Record<string, Decimal>;

/**
 * An effective-dated incentive/spiff, applied in BOTH modes (threshold-relative). — SRS COMM-005
 *  • `per_activation` — the bonus pays on each matching activation BEYOND `targetCount` (null/0 = every
 *    matching activation).
 *  • `one_time` — a single bonus once the rep reaches `targetCount` matching activations (frozen onto the
 *    threshold-crossing activation).
 */
export interface IncentiveConfig {
  id: string;
  scopeClientId: string | null; // null = all clients
  scopeProductType: string | null; // product-type key; null = all product types
  targetType: IncentiveTargetType;
  targetCount: number | null; // the threshold (per_activation: pay beyond it; one_time: reach it)
  windowStart: string; // 'YYYY-MM-DD' inclusive
  windowEnd: string; // 'YYYY-MM-DD' inclusive
  amount: Decimal; // the bonus
}

/**
 * The effective configuration, passed IN (the engine never reads a database).
 *
 * Commission is ONE flat rep rate per sale item (client decision 2026-11-13: no tiers, no 70/30; Redwave
 * applies any tier or split manually outside the system). Most specific wins:
 *   (client + product) → (product) → (client + type) → (type).
 * A greenfield internet sale skips the product steps and pays the greenfield type rate.
 */
export interface EngineConfig {
  /** Global default rate per product type. */
  flatRates: FlatRates;
  /** clientId → that client's own rate per product type. */
  flatRatesByClient?: Record<string, FlatRates>;
  /** productId → this product's own rate, overriding its product-type rate. */
  flatRatesByProduct?: Record<string, Decimal>;
  /** clientId → productId → rate. The most specific rate there is. */
  flatRatesByClientProduct?: Record<string, Record<string, Decimal>>;
  incentives?: IncentiveConfig[];
}

/** One activation (sale_item), already filtered to the period by the caller (sale_date governs). */
export interface ActivationInput {
  id: string; // sale_item id — echoed onto the output for mapping
  productType: string; // product-type key (only 'greenfield_internet' is special)
  clientId: string; // incentive scope + per-client rate lookup
  saleDate: string; // 'YYYY-MM-DD' — used for the incentive window only
  /**
   * The specific product sold, for the per-product rate lookup. Optional: an activation without one (or
   * whose product has no rate row) falls back to the product-type rate.
   */
  productId?: string | null;
}

export interface PeriodInput {
  activations: ActivationInput[];
  config: EngineConfig;
}

/** A computed per-item result. The snapshot fields are what Pay Run freezes onto sale_items. */
export interface ComputedItem {
  id: string;
  productType: string;
  rateApplied: Decimal; // the rep rate for this item
  commissionBase: Decimal; // rate only, NO incentive
  incentiveId: string | null;
  incentiveAmount: Decimal; // 0 if none
  commissionPaid: Decimal; // base + incentive — the SNAPSHOT value; equals the clawback amount
}

export interface PeriodResult {
  items: ComputedItem[];
  commissionTotal: Decimal; // Σ commissionBase — paid in full
  incentiveTotal: Decimal; // Σ incentiveAmount — paid in full
  totalEarned: Decimal; // commission + incentives (informational)
}

/** The frozen snapshot a clawback reads. — SRS CLAW-001/005 */
export interface ClawbackSnapshot {
  rateApplied: Decimal;
  incentiveAmount?: Decimal | null;
}
