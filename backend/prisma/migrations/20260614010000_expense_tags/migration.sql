-- expense_items.tags — custom free-form tags (client + channel; Meeting 3, EXP-002a). A JSONB array of
-- strings, used to categorize an expense beyond its client/category (e.g. a sales channel). Nullable →
-- applies cleanly with `prisma migrate deploy` (no backfill). — SRS §11 / CLAUDE §12

-- AlterTable
ALTER TABLE "expense_items" ADD COLUMN "tags" JSONB;
