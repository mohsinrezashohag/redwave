-- Split billing — the client EXPENSE billing document (BILL-012 / EXP-014, Meeting 3).
-- A per-client document (km + food only), SEPARATE from the commission statement/invoice: gapless-numbered
-- (CEXP-), immutable (issued|superseded), rendered in the client's currency with FX frozen at ISSUE (#12),
-- NO receipts / NO commission data (#3). Priced from the CLIENT-BILL km rate + native-currency food.
-- Additive — applies with `prisma migrate deploy` (no shadow DB). Reuses the existing BillingDocStatus enum.

-- ── client_expense_documents ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "client_expense_documents" (
    "id" UUID NOT NULL,
    "document_number" INTEGER,
    "status" "BillingDocStatus" NOT NULL DEFAULT 'issued',
    "client_id" UUID NOT NULL,
    "pay_period_id" UUID NOT NULL,
    "selection_filters" JSONB NOT NULL DEFAULT '{}',
    "line_detail" JSONB NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "fx_rate_date" DATE,
    "amount_cad" DECIMAL(12,2),
    "file_url" TEXT,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" UUID,
    CONSTRAINT "client_expense_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_expense_documents_document_number_key" ON "client_expense_documents"("document_number");
CREATE INDEX "client_expense_documents_client_id_pay_period_id_status_idx" ON "client_expense_documents"("client_id", "pay_period_id", "status");
ALTER TABLE "client_expense_documents"
  ADD CONSTRAINT "client_expense_documents_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_expense_documents"
  ADD CONSTRAINT "client_expense_documents_pay_period_id_fkey"
  FOREIGN KEY ("pay_period_id") REFERENCES "pay_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_expense_documents"
  ADD CONSTRAINT "client_expense_documents_currency_fkey"
  FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_expense_documents"
  ADD CONSTRAINT "client_expense_documents_generated_by_fkey"
  FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_expense_documents"
  ADD CONSTRAINT "client_expense_documents_superseded_by_id_fkey"
  FOREIGN KEY ("superseded_by_id") REFERENCES "client_expense_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── billing_exports: link an export artifact to an expense document ──────────────────────────────────────
ALTER TABLE "billing_exports" ADD COLUMN "client_expense_document_id" UUID;
CREATE INDEX "billing_exports_client_expense_document_id_idx" ON "billing_exports"("client_expense_document_id");
ALTER TABLE "billing_exports"
  ADD CONSTRAINT "billing_exports_client_expense_document_id_fkey"
  FOREIGN KEY ("client_expense_document_id") REFERENCES "client_expense_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── document_sequences: the CEXP gapless counter (idempotent; bootstrap also upserts it) ─────────────────
INSERT INTO "document_sequences" ("key", "current_value") VALUES ('client_expense', 0)
  ON CONFLICT ("key") DO NOTHING;
