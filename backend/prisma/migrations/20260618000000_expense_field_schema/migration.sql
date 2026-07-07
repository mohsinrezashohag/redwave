-- Per-type expense field schema + Alert/Warning validation (EXP-002a / EXP-013, Meeting 3).
-- Additive — applies with `prisma migrate deploy` (no shadow DB).
--   • expense_field_configs.fields — the per-type FIELD SCHEMA (array of field defs, config-driven).
--   • expense_field_configs.amount_soft_cap — a category-level soft cap on the item amount → Warning.
--   • expense_items.field_values — the captured per-type values ({key: value}); METADATA ONLY, never
--     summed into amount (#1). Mirrors the existing tags jsonb.

ALTER TABLE "expense_field_configs" ADD COLUMN "fields" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "expense_field_configs" ADD COLUMN "amount_soft_cap" DECIMAL(12,2);
ALTER TABLE "expense_items" ADD COLUMN "field_values" JSONB;
