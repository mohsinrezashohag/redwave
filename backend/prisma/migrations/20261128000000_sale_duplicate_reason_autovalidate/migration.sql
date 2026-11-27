-- App Review Feedback (2026-11-28): sales are validated at submit unless flagged, and a flag now also fires on
-- a matching customer name or address (not only MPU). Record WHY a sale was flagged so the reviewer sees it.
-- Additive only. Existing flags were all MPU matches.
ALTER TABLE "sales" ADD COLUMN "duplicate_reason" TEXT;
UPDATE "sales" SET "duplicate_reason" = 'mpu' WHERE "duplicate_of_sale_id" IS NOT NULL AND "duplicate_reason" IS NULL;

-- Reps may now export their own sales (App Review Feedback "Reports"). Mark those exports PERSONAL so they never
-- hide a sale from the admin's company-wide "only sales not exported before". Existing exports stay shared.
ALTER TABLE "report_exports" ADD COLUMN "personal" BOOLEAN NOT NULL DEFAULT false;
