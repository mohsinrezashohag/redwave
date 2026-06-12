-- stored_files — metadata for every upload through the unified POST /v1/files pipeline (receipts,
-- document originals): who uploaded what, when, with a SERVER-generated unique path and a sha256 of the
-- bytes. Consumers claim a path at use time (exists + uploaded_by = caller). Additive only; applies
-- cleanly with `prisma migrate deploy`. — arch §11 / security.md (file storage)

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "display_name" TEXT,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_path_key" ON "stored_files"("path");
CREATE INDEX "stored_files_uploaded_by_idx" ON "stored_files"("uploaded_by");

-- AddForeignKey (no cascade — the ledger preserves records)
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
