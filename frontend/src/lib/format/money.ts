/**
 * money(value, currency?) — DISPLAY-ONLY formatting of a decimal money STRING ("1234.5" → "$1,234.50").
 * Pure string manipulation: it groups the integer part and pads to 2 decimals WITHOUT any float arithmetic,
 * so it never violates the exact-decimal invariant (#1). For presentation only — never feed the result back
 * into a calculation or an API payload (money stays a validated decimal string end to end).
 *
 * Pass a `currency` code to label a NON-CAD amount unambiguously ("USD 250.00"); omit it (or pass CAD) for
 * the default `$` (CAD is the platform base, #12). CONVENTION: a bare `$` always means CAD — non-CAD amounts
 * ALWAYS carry their ISO code, so `$` is never ambiguous between CAD and USD. Anywhere a foreign amount can
 * appear (billing rate cards, the expense list/detail, the FX preview) MUST pass the record's currency.
 */
export function money(value: string | number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const str = String(value).trim();
  const neg = str.startsWith('-');
  const unsigned = neg ? str.slice(1) : str;
  const [intRaw, decRaw = ''] = unsigned.split('.');
  const grouped = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = (decRaw + '00').slice(0, 2);
  const prefix = currency && currency !== 'CAD' ? `${currency} ` : '$';
  return `${neg ? '-' : ''}${prefix}${grouped}.${dec}`;
}

/** Convert a decimal money string ("X.YY") to integer cents — no float (#1). */
function toCents(value: string): number {
  const str = String(value).trim();
  const neg = str.startsWith('-');
  const [intRaw, decRaw = ''] = (neg ? str.slice(1) : str).split('.');
  const cents = Number(intRaw || '0') * 100 + Number((decRaw + '00').slice(0, 2));
  return neg ? -cents : cents;
}

/**
 * sumMoney(values) — exact-decimal sum of money strings for DISPLAY (a report total). Sums integer cents,
 * so it never does float arithmetic on money (#1). Returns a "X.YY" string (pass through money() to format).
 */
export function sumMoney(values: Array<string | null | undefined>): string {
  let cents = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    cents += toCents(v);
  }
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
