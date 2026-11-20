/**
 * Regions — the Canadian provinces/territories and US states a sale address may carry. MIRRORS
 * `backend/src/common/geo/regions.ts` (the server validates new sale writes against it); keep the code lists equal.
 *
 * New sale writes (create / edit / edit request) must carry one of these CODES (client meeting 2026-11-16).
 * Legacy free text already stored is still READ as-is, and an import normalises leniently (code or full name
 * → code; anything else is kept verbatim, never an error, because address columns are optional there).
 */

export interface Region {
  code: string;
  name: string;
  country: 'CA' | 'US';
}

export const CA_PROVINCES: Region[] = [
  { code: 'AB', name: 'Alberta', country: 'CA' },
  { code: 'BC', name: 'British Columbia', country: 'CA' },
  { code: 'MB', name: 'Manitoba', country: 'CA' },
  { code: 'NB', name: 'New Brunswick', country: 'CA' },
  { code: 'NL', name: 'Newfoundland and Labrador', country: 'CA' },
  { code: 'NS', name: 'Nova Scotia', country: 'CA' },
  { code: 'NT', name: 'Northwest Territories', country: 'CA' },
  { code: 'NU', name: 'Nunavut', country: 'CA' },
  { code: 'ON', name: 'Ontario', country: 'CA' },
  { code: 'PE', name: 'Prince Edward Island', country: 'CA' },
  { code: 'QC', name: 'Quebec', country: 'CA' },
  { code: 'SK', name: 'Saskatchewan', country: 'CA' },
  { code: 'YT', name: 'Yukon', country: 'CA' },
];

export const US_STATES: Region[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name, country: 'US' as const }));

/**
 * Every region, Canada first. Note `CA` (California) is a US STATE code here, never "Canada": the list holds
 * subdivisions only, so the codes never collide (no Canadian province is coded CA).
 */
export const REGIONS: Region[] = [...CA_PROVINCES, ...US_STATES];

/** The codes a new sale write may carry. */
export const REGION_CODES: string[] = REGIONS.map((r) => r.code);

const BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Québec → Quebec
    .toLowerCase()
    .replace(/[^a-z]/g, '');
const BY_NAME = new Map(REGIONS.map((r) => [fold(r.name), r]));

export function isRegionCode(value: string | null | undefined): boolean {
  return !!value && BY_CODE.has(value.trim().toUpperCase());
}

/** A code or a full name (any case, accents ignored) → the region code; anything else → null. */
export function resolveRegion(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const code = trimmed.toUpperCase();
  if (BY_CODE.has(code)) return code;
  return BY_NAME.get(fold(trimmed))?.code ?? null;
}

/**
 * The lenient import form: resolve when possible, else keep the original text untouched (an optional
 * address column must never fail a row). Blank stays blank.
 */
/**
 * A city cell that also carries the province ("Edmonton, AB" or "Edmonton, Alberta") is split, so the address
 * never prints the province twice. Only a trailing part that resolves to a region is removed, and only when it
 * agrees with the province given (or none was given); "Saint-Jean, Québec City" style values are left alone.
 * Returns the cleaned city and the region the suffix named (null when nothing was split). 2026-11-18
 */
export function splitCityRegion(
  city: string | null | undefined,
  province: string | null | undefined,
): { city: string | null; region: string | null } {
  if (city === null || city === undefined) return { city: city ?? null, region: null };
  const m = /^(.*\S)\s*,\s*([^,]+)$/.exec(String(city).trim());
  if (!m) return { city: String(city).trim(), region: null };
  const suffix = resolveRegion(m[2]);
  if (!suffix) return { city: String(city).trim(), region: null };
  const given = resolveRegion(province ?? null);
  if (given && given !== suffix) return { city: String(city).trim(), region: null };
  return { city: m[1].trim(), region: suffix };
}

export function normaliseRegionLenient(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  return resolveRegion(trimmed) ?? trimmed;
}

// ── Frontend only: the sale form's dropdown options and the curated city lists ─────────────────────

/** Main cities per Canadian province/territory (Manitoba first-class: Redwave's home market). */
export const CITIES_BY_REGION: Record<string, string[]> = {
  MB: [
    'Winnipeg', 'Brandon', 'Steinbach', 'Thompson', 'Portage la Prairie', 'Winkler', 'Selkirk', 'Morden',
    'Dauphin', 'The Pas', 'Flin Flon', 'Stonewall', 'Niverville', 'Altona', 'Neepawa', 'Swan River',
    'Virden', 'Gimli', 'Beausejour', 'Carman', 'Oakbank', 'Lorette', 'Headingley', 'East St. Paul',
    'West St. Paul', 'Ste. Anne', 'Killarney', 'Minnedosa',
  ],
  SK: ['Saskatoon', 'Regina', 'Prince Albert', 'Moose Jaw', 'Swift Current', 'Yorkton', 'North Battleford', 'Estevan', 'Weyburn', 'Lloydminster'],
  AB: ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'St. Albert', 'Medicine Hat', 'Grande Prairie', 'Airdrie', 'Spruce Grove', 'Fort McMurray', 'Okotoks', 'Cochrane'],
  BC: ['Vancouver', 'Surrey', 'Burnaby', 'Richmond', 'Abbotsford', 'Coquitlam', 'Kelowna', 'Victoria', 'Nanaimo', 'Kamloops', 'Langley', 'Prince George', 'Chilliwack'],
  ON: ['Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor', 'Oshawa', 'Barrie', 'Sudbury', 'Thunder Bay', 'Kingston', 'Guelph', 'Kenora'],
  QC: ['Montréal', 'Québec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Saguenay', 'Lévis', 'Trois-Rivières', 'Terrebonne'],
  NB: ['Moncton', 'Saint John', 'Fredericton', 'Dieppe', 'Miramichi', 'Edmundston', 'Bathurst'],
  NS: ['Halifax', 'Dartmouth', 'Sydney', 'Truro', 'New Glasgow', 'Kentville', 'Bridgewater'],
  PE: ['Charlottetown', 'Summerside', 'Stratford', 'Cornwall'],
  NL: ["St. John's", 'Mount Pearl', 'Corner Brook', 'Conception Bay South', 'Grand Falls-Windsor', 'Gander'],
  YT: ['Whitehorse', 'Dawson City', 'Watson Lake'],
  NT: ['Yellowknife', 'Hay River', 'Inuvik', 'Fort Smith'],
  NU: ['Iqaluit', 'Rankin Inlet', 'Arviat', 'Cambridge Bay'],
  // A few for the US states nearest the Manitoba market; any other state uses "Other".
  ND: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo'],
  MN: ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth', 'Bloomington', 'Moorhead'],
};

/** The "Other" sentinel for the city dropdown (a free-text city). */
export const OTHER_CITY = '__other__';

/** Province/State options, Canada first then the US, each labelled with its code. */
export function regionOptions(): { value: string; label: string }[] {
  return REGIONS.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }));
}

/** City options for a region, plus "Other". A region with no list offers only "Other". */
export function cityOptions(regionCode: string | null | undefined): { value: string; label: string }[] {
  const cities = (regionCode && CITIES_BY_REGION[regionCode]) || [];
  return [...cities.map((c) => ({ value: c, label: c })), { value: OTHER_CITY, label: 'Other' }];
}

/** True when `city` is one of the region's listed cities (else it is shown as "Other" free text). */
export function isListedCity(regionCode: string | null | undefined, city: string | null | undefined): boolean {
  if (!regionCode || !city) return false;
  return (CITIES_BY_REGION[regionCode] ?? []).some((c) => c.toLowerCase() === city.trim().toLowerCase());
}
