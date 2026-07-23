-- Expense settings: the office address a km trip runs from. — SRS EXP-004
--
-- ADDITIVE, singleton, all-nullable. Policy is that a day's driving starts at the office, so a new km log
-- defaults its first stop to this address instead of the rep retyping it daily. A deployment that has not
-- set an office simply gets no default — nothing else changes.

CREATE TABLE "expense_settings" (
    "id" UUID NOT NULL,
    "office_address" TEXT,
    "office_lat" DECIMAL(9,6),
    "office_lng" DECIMAL(9,6),
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expense_settings" ADD CONSTRAINT "expense_settings_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
