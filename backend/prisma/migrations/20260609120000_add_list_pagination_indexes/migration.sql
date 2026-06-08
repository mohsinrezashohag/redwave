-- Indexes for the server-side list/filter/sort hot paths (arch §10). Non-destructive (CREATE INDEX only).
-- Hand-authored so it can be applied with `prisma migrate deploy` without a shadow database.

-- CreateIndex
CREATE INDEX "clients_is_active_idx" ON "clients"("is_active");

-- CreateIndex
CREATE INDEX "products_client_id_is_active_idx" ON "products"("client_id", "is_active");

-- CreateIndex
CREATE INDEX "products_product_type_idx" ON "products"("product_type");

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE INDEX "sales_client_id_sale_date_idx" ON "sales"("client_id", "sale_date");
