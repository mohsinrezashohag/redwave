-- Holds still waiting are never paid by the system: mark them settled offline. amount_released and
-- released_in_pay_run_id stay NULL, so the record still shows what was held and that the system never paid it.
UPDATE "holdback_ledger" SET "release_status" = 'settled_offline' WHERE "release_status" IN ('held', 'scheduled');
