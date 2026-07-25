-- Reps: an optional legacy/partner code an import can also resolve against. — SRS §15 IMP-004
--
-- Redwave's own working files identify a rep as "Redwave20"; the system's rep_code is "RW-D-0001". Nothing
-- linked the two, so every row of a real file failed to resolve its rep.
--
-- ADDITIVE and nullable. `rep_code` is UNTOUCHED and remains the immutable business key that is never
-- reused (#11) — this is a second, optional lookup key, not a rename. Stored UPPER-cased to match the way
-- import cleaning normalises codes, and UNIQUE so an alias can only ever identify one rep (Postgres allows
-- many NULLs under a unique index, so reps without a legacy code are unaffected).

ALTER TABLE "reps" ADD COLUMN "external_code" TEXT;

CREATE UNIQUE INDEX "reps_external_code_key" ON "reps"("external_code");
