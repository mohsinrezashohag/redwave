-- SALES EXPORT LOG — client request 2026-11-11. Redwave exports sales at any time and works in Excel, so the
-- system records every sales export (who / when / format / filters / row count) and EXACTLY which sales it
-- contained, so the next export can be "only sales not exported before" and nothing is counted twice.
--
-- Purely ADDITIVE: two nullable/defaulted columns on report_exports (existing rows unchanged: row_count NULL,
-- only_new false) and one new append-only join table. Nothing is backfilled — earlier sales exports were
-- never recorded, so every existing sale counts as "not exported before" until it is first exported.

ALTER TABLE "report_exports"
  ADD COLUMN "row_count" INTEGER,
  ADD COLUMN "only_new"  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "report_exports_report_type_generated_at_idx" ON "report_exports" ("report_type", "generated_at");

CREATE TABLE "report_export_sales" (
  "report_export_id" UUID NOT NULL,
  "sale_id"          UUID NOT NULL,
  CONSTRAINT "report_export_sales_pkey" PRIMARY KEY ("report_export_id", "sale_id")
);

CREATE INDEX "report_export_sales_sale_id_idx" ON "report_export_sales" ("sale_id");

ALTER TABLE "report_export_sales"
  ADD CONSTRAINT "report_export_sales_report_export_id_fkey"
    FOREIGN KEY ("report_export_id") REFERENCES "report_exports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "report_export_sales_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
