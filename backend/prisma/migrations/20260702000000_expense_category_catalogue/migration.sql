-- Expense categories become CONFIG, not code. — docs/claude-code/10-expense-category-enum.md (option B)
--
-- WHY: `expense_field_configs` was already the category catalogue — `category_key` unique, label, receipt/
-- description rules, per-type `fields[]`, soft cap, `is_active`, with working SA CRUD that can create a new
-- key today. The only thing keeping the list closed was that `expense_items.category` was the
-- `ExpenseCategory` ENUM, so a new key was catalogue-only until someone shipped a migration (the
-- field-config service header said exactly that). Adding "parking" is now a config change.
--
-- Behaviour, not the key, is what the code branches on. `km` drives the map/route path, the −30/−60
-- commute deduction, the server-authoritative amount and one-per-(rep,date); everything else is a standard
-- receipted expense. So an SA-added category can never silently acquire km handling, and renaming one can
-- never lose it. This mirrors `product_type_catalogue` (key + behaviour + is_system), which solved the same
-- problem for products — deliberately not a second pattern.
--
-- NOTE for the next person: the Postgres trap called out in the packet (`ALTER TYPE … ADD VALUE` cannot be
-- USED in the transaction that adds it) applies to option A, which this is not. The trap here is the
-- column type change on a table that already holds rows — handled below.

-- 1. Behaviour + is_system on the catalogue. Defaults are chosen so existing rows are already correct:
--    every seeded category is standard except km, set explicitly next.
CREATE TYPE "ExpenseCategoryBehaviour" AS ENUM ('km', 'standard');

ALTER TABLE "expense_field_configs"
  ADD COLUMN "behaviour" "ExpenseCategoryBehaviour" NOT NULL DEFAULT 'standard',
  ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

UPDATE "expense_field_configs" SET "behaviour" = 'km' WHERE "category_key" = 'km';
-- The seven day-one categories are locked; anything the SA adds later is not.
UPDATE "expense_field_configs" SET "is_system" = true
  WHERE "category_key" IN ('km', 'meals', 'hotel', 'flight', 'rental', 'gas', 'other');

-- 2. The enum column becomes text. `USING category::text` preserves every existing value verbatim — the
--    seven enum labels are exactly the seven `category_key`s, so no backfill and no data change.
ALTER TABLE "expense_items" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

-- 3. GUARD before constraining. If any item somehow carries a category with no catalogue row, fail loudly
--    HERE with a readable message rather than letting the FK abort with a constraint error — and rather
--    than assuming the two sets match. The whole migration rolls back on this.
DO $$
DECLARE orphan TEXT;
BEGIN
  SELECT DISTINCT i."category" INTO orphan
  FROM "expense_items" i
  LEFT JOIN "expense_field_configs" c ON c."category_key" = i."category"
  WHERE c."category_key" IS NULL
  LIMIT 1;

  IF orphan IS NOT NULL THEN
    RAISE EXCEPTION 'expense_items.category = % has no expense_field_configs row; seed it before migrating', orphan;
  END IF;
END $$;

-- 4. Now the reference is safe to declare. RESTRICT (the schema-wide rule — no cascades, the ledger
--    preserves records), so a category that is in use cannot be deleted out from under its items.
ALTER TABLE "expense_items"
  ADD CONSTRAINT "expense_items_category_fkey"
  FOREIGN KEY ("category") REFERENCES "expense_field_configs"("category_key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "expense_items_category_idx" ON "expense_items" ("category");

-- 5. The enum type is now unreferenced.
DROP TYPE "ExpenseCategory";
