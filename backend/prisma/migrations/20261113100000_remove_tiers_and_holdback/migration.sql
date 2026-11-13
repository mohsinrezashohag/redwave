-- No tiers and no 70/30 (client decision 2026-11-13). Every sale item pays ONE flat rep rate (per product,
-- per client, with a default per product type); Redwave applies any tier or split manually, outside the
-- system. The existing data is demo data: the prices in force are CONVERTED into flat rates first, old pay
-- runs are rewritten to the paid-in-full model, then the tier and holdback machinery is dropped.

-- 1. Product type behaviour: 'tiered' becomes 'internet' (it only marks the internet base product now).
ALTER TYPE "ProductTypeBehaviour" RENAME VALUE 'tiered' TO 'internet';

-- 2. Convert the tier schedules in force into flat rates.
--    (a) Each scope's ENTRY-bracket rate (min_count = 0) becomes that scope's `internet` type rate, unless the
--        scope already has a current internet type rate.
WITH current_cfg AS (
  SELECT DISTINCT ON (c.client_id) c.id, c.client_id, c.effective_from, c.created_by
  FROM commission_tier_configs c
  WHERE c.effective_from <= CURRENT_DATE AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE)
  ORDER BY c.client_id, c.effective_from DESC
), entry AS (
  SELECT cfg.client_id, cfg.effective_from, cfg.created_by, t.tier_number, t.rate_per_activation
  FROM current_cfg cfg JOIN commission_tiers t ON t.tier_config_id = cfg.id AND t.min_count = 0
)
INSERT INTO commission_flat_rates (id, client_id, product_type, product_id, amount, effective_from, effective_to, created_by)
SELECT gen_random_uuid(), e.client_id, 'internet', NULL, e.rate_per_activation, e.effective_from, NULL, e.created_by
FROM entry e
WHERE NOT EXISTS (
  SELECT 1 FROM commission_flat_rates f
  WHERE f.product_type = 'internet' AND f.product_id IS NULL
    AND f.client_id IS NOT DISTINCT FROM e.client_id
    AND (f.effective_to IS NULL OR f.effective_to >= CURRENT_DATE)
);

--    (b) Each per-product tier rate in force for its scope's ENTRY tier becomes that product's own rate (base
--        prices are tier 1 of a single [0, ∞) bracket, so they convert exactly).
WITH current_cfg AS (
  SELECT DISTINCT ON (c.client_id) c.id, c.client_id
  FROM commission_tier_configs c
  WHERE c.effective_from <= CURRENT_DATE AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE)
  ORDER BY c.client_id, c.effective_from DESC
), entry_tier AS (
  SELECT cfg.client_id, t.tier_number
  FROM current_cfg cfg JOIN commission_tiers t ON t.tier_config_id = cfg.id AND t.min_count = 0
), global_entry AS (
  SELECT tier_number FROM entry_tier WHERE client_id IS NULL
)
INSERT INTO commission_flat_rates (id, client_id, product_type, product_id, amount, effective_from, effective_to, created_by)
SELECT gen_random_uuid(), r.client_id, p.product_type, r.product_id, r.amount, r.effective_from, NULL, r.created_by
FROM commission_tier_rates r
JOIN products p ON p.id = r.product_id
WHERE r.effective_from <= CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
  AND r.tier_number = COALESCE(
    (SELECT e.tier_number FROM entry_tier e WHERE e.client_id = r.client_id),
    (SELECT tier_number FROM global_entry)
  )
  AND NOT EXISTS (
    SELECT 1 FROM commission_flat_rates f
    WHERE f.product_id = r.product_id AND f.client_id IS NOT DISTINCT FROM r.client_id
      AND (f.effective_to IS NULL OR f.effective_to >= CURRENT_DATE)
  );

-- 3. Pay-run lines: `commission` is the full commission. Old (demo) runs paid 70% now and 30% later; rewrite
--    them to the paid-in-full model so every run adds up: commission = gross, and net recomposed.
ALTER TABLE "pay_run_lines" RENAME COLUMN "commission_70" TO "commission";
UPDATE "pay_run_lines"
SET "commission" = COALESCE("gross_commission", "commission" + COALESCE("amount_held", 0));
UPDATE "pay_run_lines"
SET "net_payout" = "commission" + "expense_total" + "incentive_total" + "bonus_amount" - "clawback_total";
ALTER TABLE "pay_run_lines"
  DROP COLUMN "holdback_release_30",
  DROP COLUMN "amount_held",
  DROP COLUMN "gross_commission",
  DROP COLUMN "tier_at_payment",
  DROP COLUMN "internet_tally",
  DROP COLUMN "rate_per_activation";

-- 4. Payroll report lines: the rep is paid total_100 in full; the split columns go. Saved payroll layouts
--    lose the two split fields too.
ALTER TABLE "payroll_report_lines" DROP COLUMN "advance_70", DROP COLUMN "holdback_30";
UPDATE "export_layouts"
SET "columns" = COALESCE(
  (SELECT jsonb_agg(c) FROM jsonb_array_elements("columns"::jsonb) c WHERE c->>'field' NOT IN ('advance_70', 'holdback_30')),
  '[]'::jsonb
)
WHERE "report_type" = 'payroll';

-- 5. Sale items: no tier snapshot.
ALTER TABLE "sale_items" DROP COLUMN "tier_at_payment";

-- 6. Drop the tier and holdback machinery.
DROP TABLE "commission_tier_rates";
DROP TABLE "commission_tiers";
DROP TABLE "commission_tier_configs";
DROP TABLE "holdback_ledger";
DROP TABLE "holdback_release_settings";
DROP TABLE "holdback_config";
DROP TYPE "HoldbackReleaseStatus";
