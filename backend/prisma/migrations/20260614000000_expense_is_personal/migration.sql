-- expense_items.is_personal — the personal / do-not-reimburse toggle (EXP-012, Meeting 3). A personal
-- item is excluded from the reimbursable total, the pay-run seam, and all client-facing output; it is
-- captured for completeness only. Additive, non-null with a default → applies cleanly with
-- `prisma migrate deploy` (no backfill needed). — SRS §11 / CLAUDE §12

-- AlterTable
ALTER TABLE "expense_items" ADD COLUMN "is_personal" BOOLEAN NOT NULL DEFAULT false;
