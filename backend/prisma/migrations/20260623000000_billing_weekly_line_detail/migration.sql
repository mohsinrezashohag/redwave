-- Weekly client billing + the wide statement line. — docs/uat/billing-target-format.md
--
-- ADDITIVE ONLY. Issued statements/invoices are immutable and gapless-numbered, so nothing here rewrites a
-- row: legacy documents keep their pay_period_id and their narrow lines, and are still downloadable exactly
-- as issued. New documents key off the BILLING week; to get the new format for an old week, REGENERATE
-- (which mints a new number and supersedes the prior version).

-- ── The client-billing week (Monday→Sunday), numbered sequentially ("Bill 17"). Separate from pay_periods
--    (Sunday→Saturday, biweekly) because a bill straddles two of them. ─────────────────────────────────────
CREATE TABLE "billing_periods" (
    "id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PayPeriodStatus" NOT NULL,

    CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_periods_period_number_key" ON "billing_periods"("period_number");
CREATE INDEX "billing_periods_start_date_idx" ON "billing_periods"("start_date");

-- ── Statements + invoices move onto the billing week; pay_period_id is relaxed so legacy rows keep theirs ──
ALTER TABLE "client_statements" ADD COLUMN "billing_period_id" UUID;
ALTER TABLE "client_statements" ADD COLUMN "spiff_from" DATE;
ALTER TABLE "client_statements" ADD COLUMN "spiff_to" DATE;
ALTER TABLE "client_statements" ALTER COLUMN "pay_period_id" DROP NOT NULL;

ALTER TABLE "client_invoices" ADD COLUMN "billing_period_id" UUID;
ALTER TABLE "client_invoices" ALTER COLUMN "pay_period_id" DROP NOT NULL;

ALTER TABLE "client_statements" ADD CONSTRAINT "client_statements_billing_period_id_fkey"
    FOREIGN KEY ("billing_period_id") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_billing_period_id_fkey"
    FOREIGN KEY ("billing_period_id") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "client_statements_client_id_billing_period_id_status_idx"
    ON "client_statements"("client_id", "billing_period_id", "status");
CREATE INDEX "client_invoices_client_id_billing_period_id_status_idx"
    ON "client_invoices"("client_id", "billing_period_id", "status");

-- ── The wide statement line: who/where/what + the amount from EACH rate kind. Nullable throughout so lines
--    issued before this change read honestly as "not recorded" rather than as zero. ──────────────────────
ALTER TABLE "client_statement_lines" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "client_statement_lines" ADD COLUMN "sale_date" DATE;
ALTER TABLE "client_statement_lines" ADD COLUMN "rep_code" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "rep_name" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "customer_first_name" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "customer_last_name" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "address" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "channel" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "product_name" TEXT;
ALTER TABLE "client_statement_lines" ADD COLUMN "has_internet" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_statement_lines" ADD COLUMN "has_tv" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_statement_lines" ADD COLUMN "has_home_phone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_statement_lines" ADD COLUMN "internet_rate" DECIMAL(12,2);
ALTER TABLE "client_statement_lines" ADD COLUMN "tv_rate" DECIMAL(12,2);
ALTER TABLE "client_statement_lines" ADD COLUMN "hp_rate" DECIMAL(12,2);
ALTER TABLE "client_statement_lines" ADD COLUMN "bundle_bonus" DECIMAL(12,2);
ALTER TABLE "client_statement_lines" ADD COLUMN "spiff" DECIMAL(12,2);
ALTER TABLE "client_statement_lines" ADD COLUMN "other_total" DECIMAL(12,2);

CREATE INDEX "client_statement_lines_statement_id_sort_order_idx"
    ON "client_statement_lines"("statement_id", "sort_order");

-- ── The customer name split the client workbook prints as two columns. ─────────────────────────────────────
ALTER TABLE "sales" ADD COLUMN "customer_first_name" TEXT;
ALTER TABLE "sales" ADD COLUMN "customer_last_name" TEXT;
