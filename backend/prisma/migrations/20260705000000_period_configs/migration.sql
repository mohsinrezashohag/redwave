-- PERIOD CONFIG — the pay and billing calendars become admin configuration instead of seed constants.
-- — docs/claude-code/08-configurable-periods.md
--
-- Both calendars were generated at seed time from hard-coded anchors: pay Sun-Sat/14d/payday+13
-- (pay-periods.seed-data.ts) and billing Mon-Sun/7d (billing-periods.seed-data.ts). Redwave asked to
-- control both, INCLUDING the one-day boundary offset between them, so it becomes config.
--
-- Purely ADDITIVE: this table records intent. It does not touch pay_periods or billing_periods, which are
-- still referenced by finalized runs and issued documents. Nothing changes until an admin regenerates, and
-- regeneration is FORWARD-ONLY — a period carrying a finalized pay run or an issued statement/invoice is
-- refused with a 422 naming the blocking document (#2/#8). Moving a boundary under a frozen document does
-- not throw; the numbers just stop reconciling, which is why the guard is in the service and not the UI.

CREATE TYPE "PeriodKind" AS ENUM ('pay', 'billing');

CREATE TABLE "period_configs" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind"               "PeriodKind" NOT NULL,
  -- The first period's start date. Stored as a DATE at UTC midnight like every other date here, so the
  -- pure period logic stays timezone-agnostic (only "today" derivations are Winnipeg-zoned).
  "anchor_date"        DATE NOT NULL,
  -- 14 for the biweekly pay cycle, 7 for the weekly billing week.
  "length_days"        INTEGER NOT NULL,
  -- Days after a period's END that reps are paid. NULL for billing — a bill has no payday.
  "payday_offset_days" INTEGER,
  "effective_from"     DATE NOT NULL,
  "effective_to"       DATE,
  "created_by"         UUID NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "period_configs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "period_configs"
  ADD CONSTRAINT "period_configs_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scope selection: the config in force for one kind on a date (the shared effective-dating pattern, #10).
CREATE INDEX "period_configs_kind_effective_from_idx" ON "period_configs" ("kind", "effective_from");
