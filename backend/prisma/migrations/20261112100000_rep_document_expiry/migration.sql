-- REP DOCUMENT EXPIRY — client request 2026-11-12. Work / study permits, PR cards, driver's licences and passports
-- expire; HR needs to see which ones are about to. Purely ADDITIVE: one nullable DATE column, no backfill.
ALTER TABLE "rep_documents" ADD COLUMN "expires_on" DATE;
