-- Client meeting 2026-11-16: duplicate-sale approval, sale edit requests, date-range pay runs, expense config.

-- Sales: possible-duplicate flag (held for approval)
ALTER TABLE "sales" ADD COLUMN "duplicate_of_sale_id" UUID;
ALTER TABLE "sales" ADD COLUMN "duplicate_approved_by" UUID;
ALTER TABLE "sales" ADD COLUMN "duplicate_approved_at" TIMESTAMP(3);

-- Sale edit requests (rep edits within the 5-day window)
CREATE TABLE "sale_edit_requests" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_edit_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sale_edit_requests_status_idx" ON "sale_edit_requests"("status");
CREATE INDEX "sale_edit_requests_sale_id_idx" ON "sale_edit_requests"("sale_id");
ALTER TABLE "sale_edit_requests" ADD CONSTRAINT "sale_edit_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pay runs become date-range commission reports
ALTER TABLE "pay_runs" ALTER COLUMN "pay_period_id" DROP NOT NULL;
ALTER TABLE "pay_runs" ADD COLUMN "date_from" DATE;
ALTER TABLE "pay_runs" ADD COLUMN "date_to" DATE;
ALTER TABLE "pay_runs" ADD COLUMN "client_id" UUID;
ALTER TABLE "pay_runs" ADD COLUMN "rep_id" UUID;
ALTER TABLE "pay_runs" ADD COLUMN "label" TEXT;

-- Expenses: every category except km needs a receipt; gratuity field removed from Meals
UPDATE "expense_field_configs" SET "requires_receipt" = true WHERE "category_key" <> 'km';
UPDATE "expense_field_configs"
   SET "fields" = COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements("fields") f WHERE f->>'key' <> 'gratuity'), '[]'::jsonb)
 WHERE "category_key" = 'meals';
