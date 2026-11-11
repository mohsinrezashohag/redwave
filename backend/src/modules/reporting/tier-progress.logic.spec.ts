import { countToTier, TierBracket } from './tier-progress.logic';

// Schedule C v2 brackets (count boundaries only — no rates).
const SCHEDULE_C: TierBracket[] = [
  { tier_number: 4, min_count: 0, max_count: 6 },
  { tier_number: 3, min_count: 7, max_count: 16 },
  { tier_number: 2, min_count: 17, max_count: 35 },
  { tier_number: 1, min_count: 36, max_count: null },
];

describe('countToTier (pure tier-progress, no money) — RPT-001', () => {
  it('classifies a mid-bracket count and counts down to the next bracket', () => {
    // 13 activations → Tier 3 (7–16); next bracket starts at 17 → 4 to go.
    expect(countToTier(SCHEDULE_C, 13)).toEqual({
      tier_number: 3,
      count: 13,
      next_tier_min: 17,
      to_next: 4,
    });
  });

  it('handles the bottom bracket', () => {
    expect(countToTier(SCHEDULE_C, 0)).toEqual({ tier_number: 4, count: 0, next_tier_min: 7, to_next: 7 });
  });

  it('handles a bracket boundary (min edge)', () => {
    expect(countToTier(SCHEDULE_C, 17)!.tier_number).toBe(2);
    expect(countToTier(SCHEDULE_C, 16)!.tier_number).toBe(3);
  });

  it('the open top bracket has no next tier', () => {
    expect(countToTier(SCHEDULE_C, 40)).toEqual({
      tier_number: 1,
      count: 40,
      next_tier_min: null,
      to_next: null,
    });
  });

  it('empty schedule → null', () => {
    expect(countToTier([], 5)).toBeNull();
  });
});

// Client directive 2026-11-11 — "tiers off": one bracket covering every count. There is no ladder to climb,
// so no tier progress is reported (the rep dashboard hides the card).
describe('countToTier — tiers off', () => {
  it('a single [0, ∞) bracket reports NO tier, whatever the count', () => {
    const single = [{ tier_number: 1, min_count: 0, max_count: null }];
    expect(countToTier(single, 0)).toBeNull();
    expect(countToTier(single, 40)).toBeNull();
  });

  it('a real ladder still reports progress', () => {
    const ladder = [
      { tier_number: 4, min_count: 0, max_count: 6 },
      { tier_number: 3, min_count: 7, max_count: null },
    ];
    expect(countToTier(ladder, 5)).toMatchObject({ tier_number: 4, to_next: 2 });
  });
});
