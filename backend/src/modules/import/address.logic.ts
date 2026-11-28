/**
 * One-cell service address → street / city / province / postal — PURE (no I/O).
 *
 * Redwave's own billing sheets (the VF/RF/CTI "Bill" workbooks, 2026-11-28) carry the whole address in ONE
 * column: "430 Lake Ave, Lac du Bonnet, MB R0E 1A0". Mapped to Street, the city, province and postal code
 * stayed blank. This splits it on commas, reading from the END: a trailing "MB R0E 1A0" (or "MB", or a
 * province name) is the province + optional postal code, the part before it is the city, and everything
 * left is the street (so "Unit 9, 472 Loren Dr, Morgan, MB" keeps "Unit 9, 472 Loren Dr").
 *
 * Rural shapes from the RF sheet:
 *  - "SW 1/4 24-50-27 W2, SK": a legal land location + province, no town → street + province, city null.
 *  - "111 Klassen St W, Warman, SK (SW 13-40-5 W3)": a bracketed land location after the province is moved
 *    to the end of the street, so nothing is lost.
 *  - "302 Poplar Point, Martins Lake, RM of Leask No. 464, SK": the rural municipality is not the town; the
 *    town is the part before it and the RM is kept beside it: "Martins Lake (RM of Leask No. 464)".
 *
 * Conservative by design: when the tail is not a recognisable province it returns null and the caller keeps
 * the cell exactly as written. Never guesses a city from a street.
 */
import { resolveRegion } from '../../common/geo/regions';

export interface SplitAddress {
  street: string;
  /** null when the cell names no town (a bare land location + province). */
  city: string | null;
  province_state: string;
  postal_code: string | null;
}

/** Canadian postal code (A1A 1A1, space optional) or a US ZIP (12345 or 12345-6789). */
const POSTAL = /^([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)$|^(\d{5}(?:-\d{4})?)$/;

/** A municipality ("RM of Leask No. 464", "RM 397 Barrier Valley", "Town of Vermilion") — not the town itself. */
const MUNICIPALITY = /^(?:RM\b|(?:town|city|village|summer village|county|md|municipal district) of\b)/i;

/** A trailing country part a geocoder appends. */
const COUNTRY = /^(?:canada|ca|usa|us|united states(?: of america)?)$/i;

/** "MB R0E 1A0" → { region: 'MB', postal: 'R0E 1A0' }; "Manitoba" → { region: 'MB' }; else null. */
function regionAndPostal(part: string): { region: string; postal: string | null } | null {
  const whole = resolveRegion(part);
  if (whole) return { region: whole, postal: null };
  const words = part.trim().split(/\s+/);
  // Try the last one or two words as the postal code, the rest as the region.
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const postalRaw = words.slice(-take).join(' ');
    const m = POSTAL.exec(postalRaw);
    if (!m) continue;
    const region = resolveRegion(words.slice(0, -take).join(' '));
    if (!region) continue;
    const postal = m[3] ?? `${m[1]} ${m[2]}`.toUpperCase();
    return { region, postal };
  }
  return null;
}

/**
 * Split a one-cell address, or null when it isn't "street[, city], province [postal]" shaped. The street
 * keeps any earlier comma parts ("Unit 9, 472 Loren Dr").
 */
export function splitServiceAddress(value: string | null | undefined): SplitAddress | null {
  let text = (value ?? '').trim();
  // A trailing bracketed note ("SK (SW 13-40-5 W3)") is set aside and appended to the street.
  let note = '';
  const bracket = /\s*\(([^()]*)\)\s*$/.exec(text);
  if (bracket) {
    note = bracket[1].trim();
    text = text.slice(0, bracket.index).trim();
  }
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  // Geocoder-style tails (a sales-app export, 2026-11-28): "…, Alberta, T9X 1G2, Canada". Drop the country,
  // and take a postal code that sits in its own part.
  if (parts.length > 2 && COUNTRY.test(parts[parts.length - 1])) parts.pop();
  let loosePostal: string | null = null;
  const lastPostal = POSTAL.exec(parts[parts.length - 1] ?? '');
  if (parts.length > 2 && lastPostal) {
    loosePostal = lastPostal[3] ?? `${lastPostal[1]} ${lastPostal[2]}`.toUpperCase();
    parts.pop();
  }
  if (parts.length < 2) return null;
  const found = regionAndPostal(parts[parts.length - 1]);
  if (!found) return null;
  const tail = { region: found.region, postal: found.postal ?? loosePostal };
  const withNote = (street: string) => (note ? `${street} (${note})` : street);

  // "Land location, SK": no town.
  if (parts.length === 2) {
    return { street: withNote(parts[0]), city: null, province_state: tail.region, postal_code: tail.postal };
  }

  let cityIndex = parts.length - 2;
  let city = parts[cityIndex];
  // "…, Martins Lake, RM of Leask No. 464, SK": the town is the part before the municipality, which is kept
  // beside it. "Vermilion, Town of Vermilion" just names the town twice, so it is the town alone.
  if (MUNICIPALITY.test(city) && parts.length >= 4) {
    cityIndex -= 1;
    const town = parts[cityIndex];
    city = city.toLowerCase().endsWith(town.toLowerCase()) ? town : `${town} (${city})`;
  }
  const street = parts.slice(0, cityIndex).join(', ');
  if (!street || !city) return null;
  return { street: withNote(street), city, province_state: tail.region, postal_code: tail.postal };
}
