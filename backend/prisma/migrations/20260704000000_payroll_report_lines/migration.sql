-- PAYROLL REPORT LINES — the frozen wide line behind Redwave's own payroll workbook, one row per SALE.
-- — docs/claude-code/02-payroll-report.md, system-audit.md §1.1
--
-- Mirrors client_statement_lines in SHAPE and in nothing else. This is the REP-PAY stream: every amount
-- comes from the frozen sale_items snapshot, never from client_billing_rates, and no code path joins the
-- two (#3). Deliberately NO foreign key, relation or column referencing any client-billing table — the
-- separation is the fix for the previous system's core defect.
--
-- Written at pay-run FINALIZE, because that is when the snapshots freeze (#2/#8). Before finalize there is
-- genuinely no money to report.

CREATE TABLE "payroll_report_lines" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "pay_run_id" UUID NOT NULL,
  "sale_id"    UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,

  -- Who / where / what. Agent ID is the PARTNER-FACING code (reps.external_code); rep_code is retained for
  -- our own tie-out and as the render fallback. Customer and Address are ONE column each here — the
  -- payroll sheet holds a first name only, unlike the client statement which splits the name.
  "sale_date"         DATE,
  "rep_external_code" TEXT,
  "rep_code"          TEXT,
  "rep_name"          TEXT,
  "customer_name"     TEXT NOT NULL,
  "address"           TEXT,
  "channel"           TEXT,
  "product_name"      TEXT,

  "has_internet"   BOOLEAN NOT NULL DEFAULT false,
  "has_tv"         BOOLEAN NOT NULL DEFAULT false,
  "has_home_phone" BOOLEAN NOT NULL DEFAULT false,
  -- Greenfield is an ADDITION to Redwave's sheet (Meeting 4). Flat-rated and excluded from the tally (#9),
  -- so it gets its own column rather than being folded into internet.
  "is_greenfield"  BOOLEAN NOT NULL DEFAULT false,

  -- Per-component REP amounts, each read from the frozen snapshot. total_100 is their exact sum (#1);
  -- advance_70 / holdback_30 are the split as the engine computed it, never re-derived at render time.
  "internet_rate" DECIMAL(12,2),
  "tv_rate"       DECIMAL(12,2),
  "hp_rate"       DECIMAL(12,2),
  "greenfield"    DECIMAL(12,2),
  "spiff"         DECIMAL(12,2),
  "other_total"   DECIMAL(12,2),
  "total_100"     DECIMAL(12,2) NOT NULL,
  "advance_70"    DECIMAL(12,2) NOT NULL,
  "holdback_30"   DECIMAL(12,2) NOT NULL,

  CONSTRAINT "payroll_report_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payroll_report_lines"
  ADD CONSTRAINT "payroll_report_lines_pay_run_id_fkey"
    FOREIGN KEY ("pay_run_id") REFERENCES "pay_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_report_lines_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The only access pattern: every line of one run, in render order.
CREATE INDEX "payroll_report_lines_pay_run_id_sort_order_idx"
  ON "payroll_report_lines" ("pay_run_id", "sort_order");
