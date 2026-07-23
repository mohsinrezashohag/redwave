-- Import target #8: bulk-create LIVE sales (sales_entry:sales). — IMP-013
--
-- WHY: the two existing sales targets can't create live sales — `client_report:sales` only VALIDATES sales
-- that already exist, and `master_migration:sales` writes status='historical' rows that are excluded from
-- tier / pay run / clawback by design (IMP-012). Testing the tier system and clawbacks needs real sales.
--
-- The pairing (source_type, import_type) must be unique (pairingKind / the FE kindOf both reverse-resolve
-- by it) and both sales pairs are taken, so this adds a new SOURCE rather than a new type.
--
-- Hand-authored so it applies with `prisma migrate deploy` without a shadow database. Additive only, and
-- the new value is NOT used in this migration, so it is safe inside the migrate-deploy transaction
-- (PostgreSQL 12+) — same constraint as 20260610140000_import_real_historical.

ALTER TYPE "ImportSourceType" ADD VALUE IF NOT EXISTS 'sales_entry';
