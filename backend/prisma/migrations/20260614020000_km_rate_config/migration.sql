-- km_rate_config — per-client, effective-dated kilometre rate (Meeting 3, EXP-004). TWO-STREAM (#3):
-- `rep` = the reimbursement rate paid to the rep (CAD, drives the pay-run km amount); `client_bill` =
-- what the client is charged (Wave 2). A null client_id is the GLOBAL default. Selection + supersession
-- reuse common/effective-dating; back-dating is rejected. Falls back to the $0.45 constant when no row
-- applies. Additive → applies cleanly with `prisma migrate deploy`. — SRS EXP-004 / CLAUDE §3 #10

-- CreateEnum
CREATE TYPE "KmRateStream" AS ENUM ('rep', 'client_bill');

-- CreateTable
CREATE TABLE "km_rate_config" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "stream" "KmRateStream" NOT NULL,
    "rate_per_km" DECIMAL(6,3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "km_rate_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "km_rate_config_stream_client_id_effective_from_idx" ON "km_rate_config"("stream", "client_id", "effective_from");

-- AddForeignKey (no cascade — the ledger preserves records)
ALTER TABLE "km_rate_config" ADD CONSTRAINT "km_rate_config_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "km_rate_config" ADD CONSTRAINT "km_rate_config_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
