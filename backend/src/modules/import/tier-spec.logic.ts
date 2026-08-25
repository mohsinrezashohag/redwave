/**
 * PURE parser for a tier schedule written as a SINGLE cell — no I/O, no clock, deterministic.
 *
 * A tier schedule is one `commission_tier_configs` row owning N `commission_tiers` brackets, but every
 * import target in this system is "1 row = 1 entity = 1 gate unit" (the reconcile gate accepts or rejects a
 * row on its own). Splitting a schedule across four rows would break that: one bad row would leave a
 * partial schedule, and the gate could no longer judge a row by itself. So the whole schedule travels in
 * one cell, exactly as IMP-013 put a bundle's `product_types` in one cell for the same reason (§14 rule 9 —
 * an import reads the file's shape).
 *
 * Grammar — brackets separated by `|`, each `min-max:rate` with `+` for the open top bracket:
 *
 *     0-6:110|7-16:125|17-35:145|36+:160
 *
 * Tier NUMBERS are assigned by descending rate order (highest rate = Tier 1), matching Schedule C v2 where
 * Tier 1 is the top earner — the operator never has to supply them, so a file cannot disagree with itself
 * about which bracket is "tier 2". Contiguity/coverage is then checked by the SAME
 * `validateTierBrackets` the live API uses, so the import can never store a schedule the UI would reject.
 * — docs/claude-code/04-backdate-import.md, SRS COMM-001
 */
import { validateTierBrackets } from '../commission/tier-schedule.logic';

export interface ParsedTierBracket {
  tier_number: number;
  min_count: number;
  max_count: number | null;
  /** Exact decimal STRING → Prisma Decimal at the write boundary; never a float (#1). */
  rate_per_activation: string;
}

/** `36+` or `17-35`. Rate is a plain decimal with up to 2 dp. */
const BRACKET = /^(\d+)\s*(?:\+|-\s*(\d+))\s*:\s*(\d+(?:\.\d{1,2})?)$/;

/**
 * Parse + validate a tier-spec cell. Throws a bare `Error` whose message is operator-facing — callers
 * decide the surface: the CLASSIFIER turns it into a row `issue` (so the gate blocks the batch before any
 * write), and the commit handler re-parses defensively. Never returns a partial schedule.
 */
export function parseTierSpec(cell: string): ParsedTierBracket[] {
  const parts = cell
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error('tiers is empty — expected e.g. "0-6:110|7-16:125|17-35:145|36+:160"');
  }

  const parsed = parts.map((part) => {
    const m = BRACKET.exec(part);
    if (!m) {
      throw new Error(`tier bracket "${part}" is not "min-max:rate" (or "min+:rate" for the top bracket)`);
    }
    const [, min, max, rate] = m;
    return {
      min_count: Number(min),
      max_count: max === undefined ? null : Number(max),
      rate_per_activation: rate,
    };
  });

  // Tier 1 is the HIGHEST rate (Schedule C v2). Ties keep file order, so the numbering is deterministic.
  const byRateDesc = [...parsed].sort((a, b) => Number(b.rate_per_activation) - Number(a.rate_per_activation));
  const tierNumberOf = new Map(byRateDesc.map((b, i) => [b, i + 1]));
  const brackets: ParsedTierBracket[] = parsed.map((b) => ({ ...b, tier_number: tierNumberOf.get(b)! }));

  // The same contiguity/coverage guard the live API applies — an imported schedule can never be one the
  // UI would have refused. Its bare Error message is already operator-readable.
  validateTierBrackets(brackets);
  return brackets;
}
