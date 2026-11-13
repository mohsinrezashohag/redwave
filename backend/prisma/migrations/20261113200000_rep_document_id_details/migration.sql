-- HR-confirmed details read off an ID (2026-11-13), for the rep's Data accuracy comparison. The document number
-- is stored encrypted (field-cipher) plus its last four for the mask; nothing here is filled automatically.
ALTER TABLE "rep_documents"
  ADD COLUMN "name_on_document" TEXT,
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "document_number_ciphertext" TEXT,
  ADD COLUMN "document_number_last4" TEXT;
