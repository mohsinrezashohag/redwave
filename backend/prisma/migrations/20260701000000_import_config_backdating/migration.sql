-- Import targets #9–#11: back-dated CONFIG migration (km rates, tier schedules, commission flat rates).
-- — docs/claude-code/04-backdate-import.md
--
-- WHY: `effective-dates.util.ts` rejects a past `effective_from` with 422 across every effective-dated
-- config, which is correct — it protects closed periods (#10). But `client_billing_rate` already has a
-- sanctioned way in (`handlers/billing-rate.handler.ts`, the audited migration path), and the REP-stream
-- config has none. That asymmetry is what broke UAT: a km rate set mid-week left every earlier expense
-- unpriceable, and at go-live the same applies to every historical rate and tier schedule.
--
-- Three new pairs, one per row SHAPE, because TARGET_FIELDS is keyed `${source}:${import_type}` and each
-- key holds ONE flat field list that drives cleaning, mapping auto-suggestion and the template. Sharing
-- one pair across three shapes would make nearly every column optional and wreck the header scoring.
--
--   master_migration:km_rates              → km_rate_config (both streams, optional client scope)
--   master_migration:commission_tiers      → commission_tier_configs + commission_tiers
--   master_migration:commission_flat_rates → commission_flat_rates
--
-- NOT added: product_types. `product_type_catalogue` has no effective dating at all (key/label/behaviour/
-- is_system/is_active), so there is no back-date guard to bypass — the `parseEffectiveWindow` call in
-- product-type.service is for the optional INLINE flat rate, not the type. Bulk catalogue loading is a
-- different feature and the catalogue stays SA-governed (§14 rule 7).
--
-- Hand-authored so it applies with `prisma migrate deploy` without a shadow database. Additive only, and
-- the new values are NOT used in this migration, so it is safe inside the migrate-deploy transaction
-- (PostgreSQL 12+) — same constraint as 20260610140000_import_real_historical and
-- 20260621000000_import_live_sales.

ALTER TYPE "ImportType" ADD VALUE IF NOT EXISTS 'km_rates';
ALTER TYPE "ImportType" ADD VALUE IF NOT EXISTS 'commission_tiers';
ALTER TYPE "ImportType" ADD VALUE IF NOT EXISTS 'commission_flat_rates';
