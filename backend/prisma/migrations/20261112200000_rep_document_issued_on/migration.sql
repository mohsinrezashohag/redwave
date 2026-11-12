-- Rep documents: the issue date read from (or typed off) an ID, alongside expires_on. 2026-11-12
ALTER TABLE "rep_documents" ADD COLUMN "issued_on" DATE;
