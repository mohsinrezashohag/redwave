-- currency + stored-FX money model (Meeting 3, CLAUDE §3 #12). Multi-currency with a FROZEN FX snapshot:
-- foreign-capable records store {original currency, fx_rate, fx_rate_date, amount_cad}; the rate + CAD
-- value are captured once (rep-expense at APPROVAL, client-bill at ISSUE) and never re-converted. Rep pay
-- stays CAD-only (commission_*/pay_run_lines/holdback_ledger/clawbacks unchanged). Everything defaults CAD
-- (fx_rate=1, amount_cad=self), so this is INERT until a non-CAD client/item exists. Additive + backfilled
-- → applies cleanly with `prisma migrate deploy`. — BRD §8.3 / BILL-011 / EXP-014

-- ── 1. Currency catalogue (FK target for every currency column below) ───────────────────────────────
CREATE TABLE "currencies" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- Seed the primary set so the defaults + FKs below validate (bootstrap upserts these idempotently too).
INSERT INTO "currencies" ("code", "name", "symbol", "is_active") VALUES
    ('CAD', 'Canadian Dollar', '$', true),
    ('USD', 'US Dollar', '$', true);

-- ── 2. clients.currency (billing currency; existing rows default CAD) ────────────────────────────────
ALTER TABLE "clients" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CAD';
ALTER TABLE "clients" ADD CONSTRAINT "clients_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. expense_items stored-FX (frozen at APPROVAL) ─────────────────────────────────────────────────
ALTER TABLE "expense_items" ADD COLUMN "original_currency" TEXT NOT NULL DEFAULT 'CAD';
ALTER TABLE "expense_items" ADD COLUMN "fx_rate" DECIMAL(18,8);
ALTER TABLE "expense_items" ADD COLUMN "fx_rate_date" DATE;
ALTER TABLE "expense_items" ADD COLUMN "amount_cad" DECIMAL(12,2);
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_original_currency_fkey" FOREIGN KEY ("original_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: existing amounts are CAD → identity conversion (provably unchanged money).
UPDATE "expense_items"
   SET "original_currency" = 'CAD',
       "fx_rate" = 1,
       "fx_rate_date" = "expense_date",
       "amount_cad" = "amount";

-- ── 4. client_statements stored-FX (frozen at ISSUE) ────────────────────────────────────────────────
ALTER TABLE "client_statements" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CAD';
ALTER TABLE "client_statements" ADD COLUMN "fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "client_statements" ADD COLUMN "fx_rate_date" DATE;
ALTER TABLE "client_statements" ADD COLUMN "amount_cad" DECIMAL(12,2);
ALTER TABLE "client_statements" ADD CONSTRAINT "client_statements_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "client_statements"
   SET "currency" = 'CAD',
       "fx_rate" = 1,
       "fx_rate_date" = ("generated_at")::date,
       "amount_cad" = "total_amount";

-- ── 5. client_invoices stored-FX (frozen at ISSUE) ──────────────────────────────────────────────────
ALTER TABLE "client_invoices" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CAD';
ALTER TABLE "client_invoices" ADD COLUMN "fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "client_invoices" ADD COLUMN "fx_rate_date" DATE;
ALTER TABLE "client_invoices" ADD COLUMN "amount_cad" DECIMAL(12,2);
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "client_invoices"
   SET "currency" = 'CAD',
       "fx_rate" = 1,
       "fx_rate_date" = ("generated_at")::date,
       "amount_cad" = "total_commission";
