-- REP PROFILE FIELDS — client request 2026-11-11 (Naimur): a full rep profile with name, date of birth,
-- address, SIN, jacket / t-shirt size (+ the existing equipment tracking for iPads).
--
-- Purely ADDITIVE: every column is nullable, nothing is backfilled, no existing row changes.
--
-- PII: date_of_birth, phone, email and the address are redacted in every response unless the caller holds
-- hrm:edit (HRM-008), and never written into audit payloads. The SIN is NEVER stored in clear text:
-- sin_ciphertext holds an AES-256-GCM token (key in the backend env PII_ENCRYPTION_KEY, never in the
-- database), and sin_last3 keeps only the last three digits so the UI can show "••• ••• 789".
-- This also gives reps without a login their own contact columns (CLAUDE §12 "dedicated reps.contact").

ALTER TABLE "reps"
  ADD COLUMN "date_of_birth"    DATE,
  ADD COLUMN "phone"            TEXT,
  ADD COLUMN "email"            TEXT,
  ADD COLUMN "address_street"   TEXT,
  ADD COLUMN "address_city"     TEXT,
  ADD COLUMN "address_province" CHAR(2),
  ADD COLUMN "address_postal"   TEXT,
  ADD COLUMN "sin_ciphertext"   TEXT,
  ADD COLUMN "sin_last3"        CHAR(3),
  ADD COLUMN "jacket_size"      TEXT,
  ADD COLUMN "tshirt_size"      TEXT;
