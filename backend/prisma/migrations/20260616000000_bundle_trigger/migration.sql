-- client_billing_rates.bundle_product_types — the configurable trigger for a `bundle_bonus` rate
-- (Meeting 3, SRS CLNT-003/BILL-013). The product-type catalogue keys that must ALL be present on a sale
-- for the bundle bonus to apply to its client-billed line total (e.g. {home_phone,tv} for RF Now's $35
-- HP+TV bundle). Stored SORTED so it keys the effective-dating scope deterministically. Empty for every
-- non-bundle rate. Additive, non-null with a default → applies cleanly with `prisma migrate deploy`.
-- Bundles are configurable + NOT special-cased in code. — CLAUDE §3 #3 (client-bill only)

-- AlterTable
ALTER TABLE "client_billing_rates" ADD COLUMN "bundle_product_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
