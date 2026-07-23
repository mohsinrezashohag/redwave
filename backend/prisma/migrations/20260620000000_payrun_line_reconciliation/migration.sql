-- Pay-run line reconciliation facts + period-scoped holdback indexes.
--
-- WHY: the pay-run line carried only the 7 payout components + net, so the 70/30 split could not be
-- reconstructed from the UI (a $287 advance could not be shown as 70% of a $410 gross). These columns are
-- copied VERBATIM off the engine's PeriodResult at draft/finalize — no money is recomputed (#1/#5).
-- gross_commission = commission_70 + amount_held, always.
--
-- Additive only: every column is NULLable and no data statement runs. Existing draft lines are
-- delete-and-recreated by the next draft, so they self-heal; historical finalized lines simply read "—".

ALTER TABLE "pay_run_lines" ADD COLUMN "gross_commission" DECIMAL(12,2);
ALTER TABLE "pay_run_lines" ADD COLUMN "amount_held" DECIMAL(12,2);
ALTER TABLE "pay_run_lines" ADD COLUMN "tier_at_payment" INTEGER;
ALTER TABLE "pay_run_lines" ADD COLUMN "internet_tally" INTEGER;
ALTER TABLE "pay_run_lines" ADD COLUMN "rate_per_activation" DECIMAL(12,2);

-- The holdback summary queries by origin period (what was held in this period) and by scheduled release
-- period (what matures into this period). Only [rep_id, release_status] existed before.
CREATE INDEX "holdback_ledger_origin_pay_period_id_idx" ON "holdback_ledger"("origin_pay_period_id");
CREATE INDEX "holdback_ledger_scheduled_release_period_id_idx" ON "holdback_ledger"("scheduled_release_period_id");
