-- Rep documents: "Recently deleted" for 30 days, then purged (2026-11-12).
-- deleted_at set = in the bin; the daily purge removes the stored object and the row after 30 days.

-- AlterTable
ALTER TABLE "rep_documents" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" UUID;

-- CreateIndex
CREATE INDEX "rep_documents_rep_id_deleted_at_idx" ON "rep_documents"("rep_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "rep_documents" ADD CONSTRAINT "rep_documents_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
