-- Import: remember the column mapping that was actually applied to a batch. — SRS §15 IMP-002
--
-- ADDITIVE and nullable, so existing batches are untouched.
--
-- Why: `field_mapping_id` only records a SAVED mapping. When the server auto-suggests one at upload (the
-- common case) nothing was persisted, so the batch detail screen could not show what had been applied — it
-- recomputed its own, weaker client-side guess that ignored the field aliases entirely. The operator was
-- shown a mapping the server had never used, and "Apply mapping" would have committed that fiction.
--
-- Persisting it makes the detail screen display the real thing, and makes a staged batch self-describing.

ALTER TABLE "import_batches" ADD COLUMN "applied_mapping" JSONB;
