-- On-demand report exports (/reports/exports) — the audit record of each client-generated report file
-- (who, what, when — mirrors expense_exports). report_type/format are TEXT with DTO allowlists (no enum
-- migration per new type). Additive only; applies cleanly with `prisma migrate deploy`. — SRS RPT-015

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "generated_by" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "scope_filters" JSONB NOT NULL,
    "filename" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_exports_generated_by_idx" ON "report_exports"("generated_by");

-- AddForeignKey (no cascade — the ledger preserves records)
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
