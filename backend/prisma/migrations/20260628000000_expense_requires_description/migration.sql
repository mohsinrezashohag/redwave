-- Expenses: make the item DESCRIPTION requirement per-category config, like the receipt already is.
-- — SRS EXP-002a / EXP-013
--
-- Not every expense needs a sentence. A home-made meal has nothing useful to say beyond its category, and
-- forcing a description there just teaches reps to type "meal" to get past the form — which is worse than
-- no description at all, because it looks like real information.
--
-- ADDITIVE, NOT NULL, DEFAULT true, so every existing category keeps today's behaviour. Which categories
-- relax is a SEED/config decision (Meals ships relaxed), never hard-coded against a category key — the
-- catalogue is Super-Admin-governed configuration (#10).

ALTER TABLE "expense_field_configs" ADD COLUMN "requires_description" BOOLEAN NOT NULL DEFAULT true;
