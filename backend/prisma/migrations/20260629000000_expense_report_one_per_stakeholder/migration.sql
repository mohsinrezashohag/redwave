-- Expense report folders: ONE folder per stakeholder per business week, enforced by the DATABASE.
-- — SRS EXP-001
--
-- The service already tried to prevent duplicates, but keyed on `(submitted_by, rep_id, week_start)` —
-- which includes WHO TYPED IT IN. So a rep creating their own folder and an admin creating one "on behalf
-- of" that same rep produced TWO folders for one rep's week, each invisible to the other's dedup check.
-- A folder's identity is whose expenses it holds, not who opened it.
--
-- The stakeholder is:
--   * the REP, when rep_id is set;
--   * the USER, when it is not (an admin expensing their own, with no rep record).
--
-- Step 1 and 2 MERGE what already exists, because a unique index cannot be created over duplicate rows.
-- Items are moved to the keeper FIRST and only then are the emptied folders deleted — the schema has no
-- cascades and the DB RESTRICTs, so deleting a folder that still held items would fail rather than lose
-- them. The keeper is the OLDEST folder in each group, so the one people have been using survives.

-- 1. Move every duplicate's items onto the keeper.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY COALESCE(rep_id::text, 'user:' || submitted_by::text), week_start
      ORDER BY created_at, id
    ) AS keeper_id
  FROM "expense_reports"
)
UPDATE "expense_items" i
SET expense_report_id = r.keeper_id
FROM ranked r
WHERE i.expense_report_id = r.id
  AND r.id <> r.keeper_id;

-- 2. Delete the duplicates, which are now guaranteed empty.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY COALESCE(rep_id::text, 'user:' || submitted_by::text), week_start
      ORDER BY created_at, id
    ) AS keeper_id
  FROM "expense_reports"
)
DELETE FROM "expense_reports" e
USING ranked r
WHERE e.id = r.id
  AND r.id <> r.keeper_id;

-- 3. Make it a database fact. Two PARTIAL indexes, because the identity column differs by case — and a
--    plain unique on (rep_id, week_start) would not constrain the rep_id IS NULL rows at all, since
--    Postgres treats every NULL as distinct.
--
--    These also close the create() race: findFirst-then-create is not atomic, so two rapid submits could
--    both miss the existing row. Now the second one fails at the DB instead.
CREATE UNIQUE INDEX "expense_reports_rep_week_key"
  ON "expense_reports" ("rep_id", "week_start")
  WHERE "rep_id" IS NOT NULL;

CREATE UNIQUE INDEX "expense_reports_user_week_key"
  ON "expense_reports" ("submitted_by", "week_start")
  WHERE "rep_id" IS NULL;
