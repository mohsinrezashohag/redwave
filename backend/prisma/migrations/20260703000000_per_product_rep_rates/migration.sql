-- PER-PRODUCT REP RATES — a rep can be paid differently for a 150mb than a 1gig activation.
--
-- WHAT DOES NOT CHANGE, and this is the important half:
--   * The internet TALLY is still ONE cross-client number over every internet activation (#5).
--   * The bracket BOUNDARIES still live on commission_tiers and still decide WHICH tier that tally lands
--     in. A tally of 20 is Tier 2 for every product; only the RATE that tier pays now varies.
--   * A cancellation still never re-tiers a period (#6), greenfield is still excluded and flat-rated (#9).
--
-- This mirrors the per-CLIENT scoping that already exists on commission_tier_configs: scope the RATE
-- LOOKUP, never the tally. Adding a product dimension follows the identical rule.
--
-- Both changes are ADDITIVE and default to today's behaviour: with no rows in commission_tier_rates and
-- no product_id on a flat rate, every payout is byte-for-byte what it was. That is what keeps the four
-- mandatory engine fixtures (§6) passing unchanged.

-- 1. Per-(client, product, tier) rate OVERRIDE. The ladder's own rate_per_activation stays the fallback,
--    so a product with no row here pays exactly what it paid before.
CREATE TABLE "commission_tier_rates" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_id"      UUID,
  "product_id"     UUID NOT NULL,
  "tier_number"    INTEGER NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to"   DATE,
  "created_by"     UUID NOT NULL,
  CONSTRAINT "commission_tier_rates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "commission_tier_rates"
  ADD CONSTRAINT "commission_tier_rates_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "commission_tier_rates_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "commission_tier_rates_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "commission_tier_rates_product_id_client_id_tier_number_effe_idx"
  ON "commission_tier_rates" ("product_id", "client_id", "tier_number", "effective_from");

-- 2. Add-on flat rates gain the same optional product dimension. NULL keeps the existing meaning — the
--    rate for the whole product TYPE — so every existing row is untouched and still applies.
ALTER TABLE "commission_flat_rates" ADD COLUMN "product_id" UUID;

ALTER TABLE "commission_flat_rates"
  ADD CONSTRAINT "commission_flat_rates_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "commission_flat_rates_product_id_client_id_effective_from_idx"
  ON "commission_flat_rates" ("product_id", "client_id", "effective_from");
