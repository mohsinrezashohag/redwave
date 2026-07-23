-- Per-client commission tier schedules + flat rates (review item #5).
--
-- WHY: commission config was global — every client paid the same tier ladder and flat rates. These add a
-- nullable client scope with the GLOBAL row (client_id NULL) as the fallback, exactly like km_rate_config
-- (20260614020000). Existing rows keep client_id = NULL, so behaviour is unchanged until a per-client row
-- is added — no backfill, no data statements.
--
-- INVARIANTS: the internet TALLY stays cross-client (#5) — per-client means a per-client RATE lookup, never
-- a per-client tally. Scoping the rep-commission stream by client is NOT a #3 violation: nothing here reads
-- or joins client_billing_rates (precedent: incentives.scope_client_id). Holdback split stays GLOBAL — a
-- per-client split would round per client and break `advance + holdback === gross`.
--
-- No UNIQUE constraint: overlap is prevented procedurally by planSupersession, and Postgres treats NULLs as
-- distinct so a unique index on a nullable scope column would not do what it looks like it does.

ALTER TABLE "commission_tier_configs" ADD COLUMN "client_id" UUID;
ALTER TABLE "commission_flat_rates" ADD COLUMN "client_id" UUID;

ALTER TABLE "commission_tier_configs"
  ADD CONSTRAINT "commission_tier_configs_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commission_flat_rates"
  ADD CONSTRAINT "commission_flat_rates_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scope selection: the provider groups by client before picking the effective row, and the services filter
-- the supersession scope by it.
CREATE INDEX "commission_tier_configs_client_id_effective_from_idx"
  ON "commission_tier_configs"("client_id", "effective_from");
CREATE INDEX "commission_flat_rates_product_type_client_id_effective_from_idx"
  ON "commission_flat_rates"("product_type", "client_id", "effective_from");
