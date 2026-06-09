/**
 * Mapping auto-suggestion — PURE & deterministic (no I/O). Given the parsed file's column headers + the
 * target's expected fields (with aliases), suggest a `{ systemField: sourceColumn }` mapping by fuzzy
 * header matching (exact alias → normalized-contains → token overlap). The operator then adjusts + saves
 * it (IMP-002). Unmatched fields are simply omitted (surfaced as required-but-missing downstream). — SRS §15
 */
import { TargetField } from './target-fields';

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Suggest a mapping for the given headers + target fields. Returns `{ systemField: sourceColumn }`. */
export function suggestMapping(headers: string[], fields: TargetField[]): Record<string, string> {
  const normHeaders = headers.map((h) => ({ raw: h, norm: norm(h) }));
  const used = new Set<string>();
  const mapping: Record<string, string> = {};

  for (const field of fields) {
    const candidates = [field.field, field.label, ...field.aliases].map(norm);
    let pick: string | null = null;

    // 1) exact normalized match against any alias
    for (const h of normHeaders) {
      if (used.has(h.raw)) continue;
      if (candidates.includes(h.norm)) {
        pick = h.raw;
        break;
      }
    }
    // 2) contains (either direction) on a meaningful alias
    if (!pick) {
      for (const h of normHeaders) {
        if (used.has(h.raw)) continue;
        if (candidates.some((c) => c.length >= 3 && (h.norm.includes(c) || c.includes(h.norm)))) {
          pick = h.raw;
          break;
        }
      }
    }
    // 3) token overlap (any shared word ≥3 chars)
    if (!pick) {
      const fieldTokens = new Set(candidates.flatMap((c) => c.split(' ')).filter((t) => t.length >= 3));
      for (const h of normHeaders) {
        if (used.has(h.raw)) continue;
        const hTokens = h.norm.split(' ');
        if (hTokens.some((t) => t.length >= 3 && fieldTokens.has(t))) {
          pick = h.raw;
          break;
        }
      }
    }

    if (pick) {
      mapping[field.field] = pick;
      used.add(pick);
    }
  }
  return mapping;
}
