-- Data Import & Integration — real pipeline support: a `historical` sale status (reference-only — never
-- enters the rep pay pipeline, blended into business aggregations), a `billing_rates` import target, the
-- historical billed-amount reference on sale_items, and import-batch provenance on sales. — SRS §15 / §17
--
-- Hand-authored so it applies with `prisma migrate deploy` without a shadow database. Additive only
-- (ADD VALUE / ADD COLUMN / CREATE INDEX). Enum values are appended; they are not USED in this migration,
-- so they are safe to add inside the migrate-deploy transaction (PostgreSQL 12+).

-- 1) New enum values.
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'historical';
ALTER TYPE "ImportType" ADD VALUE IF NOT EXISTS 'billing_rates' AFTER 'products';

-- 2) Historical billed-amount reference (business-aggregation only; NOT commission, #3).
ALTER TABLE "sale_items" ADD COLUMN "historical_billed_amount" DECIMAL(12,2);

-- 3) Import-batch provenance on sales (no FK — polymorphic, like matched_entity_id; IMP-008).
ALTER TABLE "sales" ADD COLUMN "import_batch_id" UUID;
CREATE INDEX "sales_import_batch_id_idx" ON "sales"("import_batch_id");
