-- EXPORT LAYOUTS — which columns an exported report carries, in what order, under what headings.
-- — docs/claude-code/09-configurable-exports.md
--
-- Mirrors import_field_mappings: a saved, named, optionally per-client configuration, so a Redwave format
-- change is a settings change rather than a dev ticket.
--
-- #3 IS ENFORCED IN THE FIELD REGISTRY, NOT IN THIS TABLE. A layout only names field keys; the registry
-- decides which keys each report type may offer, and the payroll registry contains no client-rate field
-- while the statement registry contains no rep-pay field. A configurable layout is exactly where someone
-- could quietly reunite the two rate streams, so the split lives one level below the configuration.
--
-- #2 — client_statements.export_layout_id freezes the layout a document was ISSUED with, so re-downloading
-- a historical statement reproduces the original rather than today's configuration. It is NULLABLE and
-- every existing row keeps NULL, meaning the built-in default — which is how those documents were issued,
-- so they re-render byte-identically.

CREATE TABLE "export_layouts" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"        TEXT NOT NULL,
  -- 'payroll' | 'statement' | 'sales' | 'expenses'. A plain TEXT rather than an enum so a new report type
  -- needs no migration — the registry is the source of truth for what is valid.
  "report_type" TEXT NOT NULL,
  "client_id"   UUID,
  -- Ordered column list: [{ field, header }]. Validated against the registry on write.
  "columns"     JSONB NOT NULL,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_by"  UUID NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_layouts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "export_layouts"
  ADD CONSTRAINT "export_layouts_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "export_layouts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "export_layouts_report_type_client_id_idx" ON "export_layouts" ("report_type", "client_id");

-- The layout frozen onto an issued statement. RESTRICT, so a layout in use by an issued document can never
-- be deleted out from under it (#2 — an issued document is immutable, including how it renders).
ALTER TABLE "client_statements" ADD COLUMN "export_layout_id" UUID;

ALTER TABLE "client_statements"
  ADD CONSTRAINT "client_statements_export_layout_id_fkey"
    FOREIGN KEY ("export_layout_id") REFERENCES "export_layouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
