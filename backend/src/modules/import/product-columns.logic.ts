/**
 * Column-per-product-type layout — PURE & deterministic (no I/O).
 *
 * Redwave's own working files don't list a household's products in one cell. They give each product type its
 * own yes/no COLUMN:
 *
 *     Sale Date | Agent ID | Customer | Address | Channel | Product | Internet | TV | Home Phone | ...
 *     2026-07-13| Redwave20| Mark T.  | 23 Shore| VF      | Fibre 1g| true     |false| false     | ...
 *
 * The single-cell format (`"internet,tv"`) stays fully supported — this just teaches the pipeline to READ the
 * other shape, so a real file imports untouched instead of being reshaped by hand every cycle.
 *
 * Two rules keep it safe:
 *  - detection is EXACT (`resolveVocabExact`), so `"Internet Rate"` is never mistaken for the internet flag;
 *  - an explicit product-types cell always WINS. Derivation is the fallback for when there isn't one, or when
 *    the one there is doesn't name any known type (real files put a marketing name like `"Fibre 1gig/2.5gig"`
 *    in a column called `Product`).
 * — SRS §15 IMP-004
 */
import { isTrue } from './clean.logic';
import { RawRow } from './mapping.logic';
import { resolveVocabExact, resolveVocabValue, Vocab, VocabResolution } from './value-vocabulary.logic';

/** A trailing "add-on" / "addon" / "add on" on a yes/no product column header. */
const ADD_ON_SUFFIX = /[\s_-]*add[\s_-]?on\s*$/i;

/** A contact-number column header ("Phone", "Phone Number", "Cell", "Mobile"), never a product flag. */
const CONTACT_COLUMN = /^(?:phone(?:\s*(?:number|no|#))?|cell(?:\s*phone)?|mobile)$/i;

export interface ProductTypeColumn {
  /** The source column header, verbatim. */
  column: string;
  /** The catalogue key it names. */
  key: string;
}

/**
 * Which of the file's columns are product-type flags. A column qualifies only when its header resolves
 * EXACTLY to a catalogue key; `excludeColumns` drops any header already claimed by another system field, so
 * a mapped column is never read twice.
 */
export function detectProductTypeColumns(headers: string[], vocab: Vocab, excludeColumns: string[] = []): ProductTypeColumn[] {
  const excluded = new Set(excludeColumns);
  const seen = new Set<string>();
  const out: ProductTypeColumn[] = [];
  for (const header of headers) {
    if (excluded.has(header)) continue;
    // "Phone" / "Cell" is the customer's contact number, not the home-phone flag, even though "phone" is a
    // valid cell VALUE for the home-phone type ("Internet, Phone"). — 2026-11-28
    if (CONTACT_COLUMN.test(header.trim())) continue;
    // "TV Add-on" / "Home Phone Add-on" (a sales-app export, 2026-11-28) name the type too. Only that exact
    // suffix is stripped, so "TV Package" or "Internet Rate" still never read as a flag.
    const key = resolveVocabExact(header, vocab) ?? resolveVocabExact(header.replace(ADD_ON_SUFFIX, ''), vocab);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    out.push({ column: header, key });
  }
  return out;
}

/**
 * The types on one row. An explicit cell wins when it names anything known; otherwise the truthy flag
 * columns are used. When neither yields anything the explicit resolution is returned unchanged, so the
 * classifier still reports the original problem rather than a misleading "no product type".
 */
export function resolveRowProductTypes(
  raw: RawRow,
  explicitCell: unknown,
  typeColumns: ProductTypeColumn[],
  vocab: Vocab,
): VocabResolution {
  const explicit = resolveVocabValue(explicitCell, vocab);
  if (explicit.keys.length > 0 && explicit.unknown.length === 0) {
    return explicit;
  }
  const derived = typeColumns.filter((c) => isTrue(raw[c.column])).map((c) => c.key);
  if (derived.length > 0) {
    return { keys: derived, unknown: [], suggestion: derived.join(' + ') };
  }
  return explicit;
}

/**
 * A row-level explanation for the preview: what the flag columns say, so an operator can see at a glance
 * that "Internet ✓ TV ✗ Home Phone ✗" became `internet`.
 */
export function describeTypeColumns(columns: ProductTypeColumn[]): string {
  return columns.map((c) => `${c.column} → ${c.key}`).join(', ');
}
