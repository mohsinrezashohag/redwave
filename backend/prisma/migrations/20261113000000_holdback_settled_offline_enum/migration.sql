-- No holdback since 2026-11-13 (client decision): commission is paid in full; holds are handled offline.
-- A new status for holds that were still waiting at that point. Its own migration, because Postgres cannot
-- use a new enum value inside the transaction that adds it.
ALTER TYPE "HoldbackReleaseStatus" ADD VALUE 'settled_offline';
