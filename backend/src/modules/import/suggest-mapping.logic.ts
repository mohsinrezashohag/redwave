/**
 * Mapping auto-suggestion — PURE & deterministic (no I/O). Given the parsed file's column headers + the
 * target's expected fields (with aliases), suggest a `{ systemField: sourceColumn }` mapping. The operator
 * then adjusts + saves it (IMP-002). Unmatched fields are simply omitted (surfaced as required-but-missing
 * downstream). — SRS §15
 *
 * Assignment is GLOBALLY SCORED, not first-come-first-served. The earlier version walked the fields in
 * declaration order and let each take the first header it liked, so a field declared early could capture a
 * column that a later field matched far better — e.g. `client_code` (alias "code") swallowing a `Rep code`
 * column, leaving `rep_code` unmapped. Every (field, header) pair is now scored and the strongest pairs are
 * claimed first, so a weaker claim can never pre-empt a stronger one. Ties break on declaration order, which
 * keeps the result deterministic.
 */
import { TargetField } from './target-fields';
import { normalizeToken } from './normalize';

// The SAME fold used for cell values (`value-vocabulary.logic`) — a header alias and a vocabulary label
// must normalise identically, or a file can map cleanly and still fail to classify.
const norm = normalizeToken;

/** Match strength, highest first. Exact beats containment beats a shared word. */
const EXACT = 100;
const CONTAINS = 50;
const TOKEN = 20;

/** Score one field against one header. 0 means "no relationship" and is never assigned. */
export function scorePair(field: TargetField, header: string): number {
  const candidates = [field.field, field.label, ...field.aliases].map(norm);
  const h = norm(header);
  if (h === '') return 0;

  if (candidates.includes(h)) return EXACT;

  // Containment, in either direction, on a meaningful alias. Longer overlaps score higher so
  // "rep code" beats a bare "code" for a `Rep code` column.
  let best = 0;
  for (const c of candidates) {
    if (c.length >= 3 && (h.includes(c) || c.includes(h))) {
      best = Math.max(best, CONTAINS + c.length);
    }
  }
  if (best > 0) return best;

  // A shared word of ≥3 characters.
  const fieldTokens = new Set(candidates.flatMap((c) => c.split(' ')).filter((t) => t.length >= 3));
  const shared = h.split(' ').filter((t) => t.length >= 3 && fieldTokens.has(t));
  return shared.length > 0 ? TOKEN + shared.length : 0;
}

/** Suggest a mapping for the given headers + target fields. Returns `{ systemField: sourceColumn }`. */
export function suggestMapping(headers: string[], fields: TargetField[]): Record<string, string> {
  const pairs: { field: string; header: string; score: number; order: number }[] = [];
  fields.forEach((field, order) => {
    for (const header of headers) {
      const score = scorePair(field, header);
      if (score > 0) pairs.push({ field: field.field, header, score, order });
    }
  });

  // Strongest first; ties fall back to declaration order, then header order, so the result is stable.
  pairs.sort((a, b) => b.score - a.score || a.order - b.order || headers.indexOf(a.header) - headers.indexOf(b.header));

  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();
  for (const pair of pairs) {
    if (mapping[pair.field] !== undefined || usedHeaders.has(pair.header)) continue;
    mapping[pair.field] = pair.header;
    usedHeaders.add(pair.header);
  }
  return mapping;
}
