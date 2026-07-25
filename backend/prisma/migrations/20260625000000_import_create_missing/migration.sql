-- Import: remember whether a batch was staged with "create missing master data". — SRS §15 IMP-003
--
-- ADDITIVE, NOT NULL with a DEFAULT of false, so every existing batch keeps today's behaviour exactly
-- (an unresolvable client/rep/product stays an error).
--
-- Why it must be PERSISTED rather than passed per request: classification re-runs on remap and on a
-- single-row reconcile edit. Without the flag on the batch, those re-runs would judge the rows under the
-- opposite rule and silently flip staged rows back to `error` after the operator had already opted in.
--
-- The flag only ever applies to master_migration + sales (reference-only history); the service rejects it
-- on every other target, most importantly LIVE sales entry, where invented master data would reach the
-- commission engine.

ALTER TABLE "import_batches" ADD COLUMN "create_missing" BOOLEAN NOT NULL DEFAULT false;
