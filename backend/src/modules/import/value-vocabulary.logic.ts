/**
 * Value vocabulary — PURE & deterministic (no I/O). The layer the pipeline was missing: mapping normalises
 * COLUMN NAMES and cleaning normalises CELL FORMATS (dates/money/codes), but nothing normalised CELL VALUES
 * against the system's own vocabularies. So a human-written `"Internet, TV"` never matched the catalogue key
 * `internet`, and every row errored with a misleading "no ... product for client" message.
 *
 * Resolution is deliberately layered, because `/` is BOTH a list separator ("Internet / TV") and a legitimate
 * label character (a custom "TV/Streaming" type):
 *   1. the WHOLE cell, matched exactly — a punctuated label always wins over being torn apart;
 *   2. split on the unambiguous list separators (`,` `;` `|` newline);
 *   3. only a fragment that still doesn't resolve is split again on `/` and `+`.
 * A value that resolves to nothing stays UNKNOWN — never forced to a near miss, because a wrong guess
 * silently mis-files a sale ("Fibre Optic" is not internet).
 *
 * Vocabularies are CATALOGUE-DRIVEN: `buildProductTypeVocab` is fed from `product_type_catalogue`, so an
 * SA-added `standard_addon` ("Protection Plan" → `protection_plan`) resolves with NO code change. — SRS §15
 */
import { normalizeToken, squashToken } from './normalize';

export interface VocabEntry {
  /** The canonical value stored in the DB (a catalogue key, enum value, or code). */
  key: string;
  /** Human-facing labels (e.g. the catalogue's `label` column). */
  labels?: string[];
  /** Extra accepted spellings. */
  aliases?: string[];
}

export type Vocab = VocabEntry[];

export interface VocabResolution {
  /** Canonical keys in source order, de-duplicated. */
  keys: string[];
  /** Raw fragments that matched nothing (verbatim, for the operator-facing message). */
  unknown: string[];
  /** The canonical form of what DID resolve, for a "did you mean …" hint. Null when nothing resolved. */
  suggestion: string | null;
}

/** Unambiguous list separators — these never appear inside a product label. */
const PRIMARY_SEPARATORS = /[,;|\n\r]+/;
/** Also used as separators, but only once a fragment has failed to resolve on its own. */
const SECONDARY_SEPARATORS = /[/+]+/;

/**
 * Static synonyms the CATALOGUE cannot know, keyed by canonical key. Applied only when that key is actually
 * present in the vocabulary, so this never invents a type. Deliberately SHORT and unambiguous.
 */
const SYNONYMS: Record<string, string[]> = {
  internet: ['broadband'],
  tv: ['cable', 'television'],
  home_phone: ['hp', 'phone', 'landline'],
  greenfield_internet: ['gf', 'greenfield', 'green field'],
};

interface Indexed {
  key: string;
  /** Every accepted spelling of this entry, already normalised. */
  forms: Set<string>;
  /** The same forms with spaces squashed out (`home phone` → `homephone`). */
  squashed: Set<string>;
}

function indexVocab(vocab: Vocab): Indexed[] {
  return vocab.map((entry) => {
    const raw = [entry.key, ...(entry.labels ?? []), ...(entry.aliases ?? []), ...(SYNONYMS[entry.key] ?? [])];
    const forms = new Set(raw.map(normalizeToken).filter((s) => s !== ''));
    const squashed = new Set(raw.map(squashToken).filter((s) => s !== ''));
    return { key: entry.key, forms, squashed };
  });
}

/** Exact match only: the normalised text, then the space-squashed text. */
function resolveExact(text: string, index: Indexed[]): string | null {
  const norm = normalizeToken(text);
  if (norm === '') return null;
  const exact = index.find((e) => e.forms.has(norm));
  if (exact) return exact.key;
  const squash = squashToken(text);
  return index.find((e) => e.squashed.has(squash))?.key ?? null;
}

/**
 * Exact, else a SINGLE unambiguous whole-word containment (`"Internet 1Gb"` → internet). If two entries are
 * contained (`"Internet TV"`) the cell is ambiguous and stays unknown — reporting it beats silently dropping
 * one of them.
 */
function resolveLoose(text: string, index: Indexed[]): string | null {
  const exact = resolveExact(text, index);
  if (exact) return exact;
  const words = ` ${normalizeToken(text)} `;
  const contained = index.filter((e) => [...e.forms].some((f) => f.length >= 2 && words.includes(` ${f} `)));
  return contained.length === 1 ? contained[0].key : null;
}

function merge(into: { keys: string[]; unknown: string[] }, key: string | null, raw: string): void {
  if (key === null) {
    into.unknown.push(raw);
  } else if (!into.keys.includes(key)) {
    into.keys.push(key);
  }
}

/** Resolve one primary fragment, splitting it on the secondary separators only if it doesn't resolve whole. */
function resolvePiece(fragment: string, index: Indexed[]): { keys: string[]; unknown: string[] } {
  const out = { keys: [] as string[], unknown: [] as string[] };
  const whole = resolveExact(fragment, index);
  if (whole) {
    out.keys.push(whole);
    return out;
  }
  const pieces = fragment
    .split(SECONDARY_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (pieces.length <= 1) {
    merge(out, resolveLoose(fragment, index), fragment.trim());
    return out;
  }
  for (const piece of pieces) {
    merge(out, resolveLoose(piece, index), piece);
  }
  return out;
}

/** Split a cell on the primary list separators. */
export function splitValues(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split(PRIMARY_SEPARATORS)
    .flatMap((s) => s.split(SECONDARY_SEPARATORS))
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Resolve a cell against a vocabulary. Handles both single-value fields (caller asserts `keys.length === 1`)
 * and multi-value ones. An empty cell resolves to nothing with no error — required-ness is the classifier's
 * call, not the vocabulary's.
 */
export function resolveVocabValue(raw: unknown, vocab: Vocab): VocabResolution {
  const index = indexVocab(vocab);
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (text === '') {
    return { keys: [], unknown: [], suggestion: null };
  }

  // 1) The WHOLE cell, exactly — so a label containing a separator is never torn apart.
  const whole = resolveExact(text, index);
  if (whole) {
    return { keys: [whole], unknown: [], suggestion: whole };
  }

  // 2) Otherwise treat it as a list.
  const out = { keys: [] as string[], unknown: [] as string[] };
  const fragments = text
    .split(PRIMARY_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  for (const fragment of fragments) {
    const part = resolvePiece(fragment, index);
    for (const key of part.keys) {
      if (!out.keys.includes(key)) out.keys.push(key);
    }
    out.unknown.push(...part.unknown);
  }
  return { ...out, suggestion: out.keys.length > 0 ? out.keys.join(' + ') : null };
}

/**
 * EXACT resolution only — no loose containment. Used where a near miss would be actively wrong: detecting
 * which FILE COLUMNS are product-type flags. Loose matching would read `"Internet Rate"` as the internet
 * column and start treating a dollar figure as a yes/no flag.
 */
export function resolveVocabExact(raw: unknown, vocab: Vocab): string | null {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (text === '') return null;
  return resolveExact(text, indexVocab(vocab));
}

/** Build the product-type vocabulary from the `product_type_catalogue` rows (key + label). */
export function buildProductTypeVocab(rows: { key: string; label?: string | null }[]): Vocab {
  return rows.map((r) => ({ key: r.key, labels: r.label ? [r.label] : [] }));
}

// ── Static vocabularies for the enum-ish columns ────────────────────────────────────────────────
export const MARKET_VOCAB: Vocab = [
  { key: 'CA', labels: ['Canada'], aliases: ['can', 'ca', 'canadian'] },
  { key: 'US', labels: ['United States'], aliases: ['usa', 'u s a', 'america', 'united states of america'] },
];

export const RATE_KIND_VOCAB: Vocab = [
  { key: 'product', labels: ['Product'], aliases: ['product rate', 'base', 'base rate'] },
  { key: 'tv_addon', labels: ['TV add-on'], aliases: ['tv addon', 'tv add on'] },
  { key: 'hp_addon', labels: ['Home phone add-on'], aliases: ['hp addon', 'hp add on', 'home phone addon'] },
  { key: 'spiff', labels: ['Spiff'], aliases: ['promo', 'promotion'] },
  { key: 'bundle_bonus', labels: ['Bundle bonus'], aliases: ['bundle', 'bonus'] },
];

export const REP_STATUS_VOCAB: Vocab = [
  { key: 'active', labels: ['Active'] },
  { key: 'terminated', labels: ['Terminated'], aliases: ['inactive', 'ended', 'left'] },
];

export const SALE_STATUS_VOCAB: Vocab = [
  { key: 'entered', labels: ['Entered'], aliases: ['new', 'draft'] },
  { key: 'validated', labels: ['Validated'], aliases: ['confirmed', 'approved'] },
];

/**
 * Resolve a SINGLE-valued cell. Returns the key, or `null` plus the offending text — the shape classifiers
 * want. An empty cell is `{ key: null, unknown: null }` (absent, not invalid) so required-ness stays the
 * caller's decision.
 */
export function resolveSingle(raw: unknown, vocab: Vocab): { key: string | null; unknown: string | null } {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (text === '') return { key: null, unknown: null };
  const res = resolveVocabValue(raw, vocab);
  if (res.keys.length === 1 && res.unknown.length === 0) {
    return { key: res.keys[0], unknown: null };
  }
  return { key: null, unknown: text };
}
