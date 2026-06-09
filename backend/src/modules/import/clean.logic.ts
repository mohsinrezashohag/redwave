/**
 * Cleaning — PURE & deterministic (no I/O). Normalises parsed cell values per system-field TYPE so the
 * downstream classifiers/handlers receive clean data: whitespace trimmed, **dates → 'YYYY-MM-DD'** (the
 * cell's own calendar day — never timezone-shifted, so an explicit date never drifts), **money → an exact
 * decimal STRING** (strip `$`/commas, ≤2dp, never float, #1), **codes normalised** (UPPER-cased — kills the
 * VF/Vf legacy inconsistency), missing → `null`. Unknown fields get whitespace-trim only. — SRS §15 IMP-004
 */
import { RawRow } from './mapping.logic';

export type FieldType = 'text' | 'date' | 'money' | 'code' | 'int';

/** Trim whitespace; empty → null. The base normalisation for every cell. */
export function normWs(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function ymd(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Coerce a date cell to 'YYYY-MM-DD'. Handles a JS Date (from exceljs — uses its UTC calendar day, so a
 * date-only cell never shifts), ISO strings, North-American M/D/Y, and Excel serial numbers. Unparseable → null.
 */
export function coerceDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    return ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  const s = String(v).trim();
  if (s === '') return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return ymd(Number(y), Number(m), Number(d));
  }
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (slash) {
    const [, mo, d, y] = slash;
    const year = y.length === 2 ? Number(`20${y}`) : Number(y);
    return ymd(year, Number(mo), Number(d)); // North-American month/day/year
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 59) {
      // Excel serial → days since 1899-12-30 (the 1900 leap-year bug offset 25569 to the unix epoch).
      const dt = new Date((serial - 25569) * 86400 * 1000);
      return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  return null;
}

/** Coerce a money cell to an exact decimal STRING (≤2dp). Strips `$`/commas; accounting `(123.45)` → `-123.45`. */
export function coerceMoney(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim();
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`; // accounting negatives
  s = s.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const abs = neg ? s.slice(1) : s;
  const [int, frac = ''] = abs.split('.');
  const cents = `${frac}00`.slice(0, 2);
  return `${neg ? '-' : ''}${int || '0'}.${cents}`;
}

/** Coerce an integer cell to a numeric string. */
export function coerceInt(v: unknown): string | null {
  const s = normWs(v);
  if (s === null) return null;
  const n = s.replace(/[,\s]/g, '');
  return /^-?\d+$/.test(n) ? n : null;
}

/** Normalise a code/identifier: trim + UPPER-case (so VF and Vf collapse to one). */
export function normCode(v: unknown): string | null {
  const s = normWs(v);
  return s ? s.toUpperCase() : null;
}

/** Clean a single value by its field type. */
export function cleanValue(value: unknown, type: FieldType): string | null {
  switch (type) {
    case 'date':
      return coerceDate(value);
    case 'money':
      return coerceMoney(value);
    case 'code':
      return normCode(value);
    case 'int':
      return coerceInt(value);
    default:
      return normWs(value);
  }
}

/** Clean every field of a mapped row by its declared type; unknown fields get whitespace-trim only. */
export function cleanMappedRow(mapped: RawRow, fieldTypes: Record<string, FieldType>): RawRow {
  const out: RawRow = {};
  for (const [field, value] of Object.entries(mapped)) {
    out[field] = cleanValue(value, fieldTypes[field] ?? 'text');
  }
  return out;
}
