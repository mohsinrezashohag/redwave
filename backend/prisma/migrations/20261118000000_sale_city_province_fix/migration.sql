-- 2026-11-18: some sales were stored with the province inside the city ("Edmonton, AB" + province AB), so the
-- address printed "Edmonton, AB, AB". Keep only the city when the trailing part is exactly the sale's own
-- province code. Address fields are not money and not a pay snapshot (#2), so correcting them in place is safe.
-- Create, edit and the live-sales import now split such values themselves (common/geo/regions#splitCityRegion).
UPDATE "sales"
SET "city" = btrim(regexp_replace("city", '\s*,\s*[^,]+$', ''))
WHERE "city" ~ ',\s*[A-Za-z]{2}\s*$'
  AND upper(btrim(substring("city" from ',\s*([^,]+)$'))) = upper(btrim("province_state"));
