/**
 * tiers.logic — a CLIENT-SIDE MIRROR of the backend `validateTierBrackets` (the contiguity rule), so the
 * tier-bracket editor can show errors BEFORE submit. This is STORAGE VALIDATION ONLY — it never determines
 * which tier a rep falls into (#5: the engine owns tiering at runtime). The server re-validates (422). Returns
 * the first violation message, or null if the schedule is a valid contiguous Schedule-C-style set.
 */
export interface BracketInput {
  tier_number: number;
  min_count: number;
  max_count: number | null;
  rate_per_activation: string;
}

const isWhole = (n: number) => Number.isInteger(n) && n >= 0;

export function validateTierBrackets(brackets: BracketInput[]): string | null {
  if (brackets.length === 0) return 'Add at least one bracket.';
  for (const b of brackets) {
    if (!isWhole(b.min_count) || (b.max_count !== null && !isWhole(b.max_count))) {
      return 'Tally bounds must be whole numbers (0 or more).';
    }
    if (!/^\d+(\.\d{1,2})?$/.test(b.rate_per_activation)) {
      return `Tier ${b.tier_number}: enter a rate (max 2 decimals).`;
    }
  }
  const open = brackets.filter((b) => b.max_count === null);
  if (open.length !== 1) return 'Exactly one bracket must be the open-ended top tier (no upper bound).';

  const sorted = [...brackets].sort((a, b) => a.min_count - b.min_count);
  if (sorted[0].min_count !== 0) return 'The lowest bracket must start at 0.';
  if (sorted[sorted.length - 1].max_count !== null) return 'The open-ended bracket must be the highest tier.';

  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i];
    if (b.max_count !== null && b.max_count < b.min_count) return `Tier ${b.tier_number}: max must be ≥ min.`;
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.max_count === null || b.min_count !== prev.max_count + 1) {
        return 'Brackets must be continuous: each minimum is the previous maximum plus 1, with no gaps or overlaps.';
      }
    }
  }
  return null;
}
