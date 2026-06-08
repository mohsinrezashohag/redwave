-- Client custom fields — SA-defined name/value pairs carrying extra info beyond the fixed client columns.
-- Hand-authored so it applies with `prisma migrate deploy` without a shadow database. Additive (CREATE
-- TABLE only). Replace-in-place on client create/edit; no cascade (the ledger preserves records).

CREATE TABLE "client_custom_fields" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_value" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_custom_fields_client_id_idx" ON "client_custom_fields"("client_id");

ALTER TABLE "client_custom_fields"
  ADD CONSTRAINT "client_custom_fields_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
