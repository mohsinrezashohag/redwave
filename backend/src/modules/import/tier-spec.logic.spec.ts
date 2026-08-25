import { parseTierSpec } from './tier-spec.logic';

describe('parseTierSpec — a whole tier schedule in one cell', () => {
  it('parses Schedule C v2 and numbers tiers by DESCENDING rate (Tier 1 = top earner)', () => {
    const brackets = parseTierSpec('0-6:110|7-16:125|17-35:145|36+:160');
    expect(brackets).toEqual([
      { tier_number: 4, min_count: 0, max_count: 6, rate_per_activation: '110' },
      { tier_number: 3, min_count: 7, max_count: 16, rate_per_activation: '125' },
      { tier_number: 2, min_count: 17, max_count: 35, rate_per_activation: '145' },
      { tier_number: 1, min_count: 36, max_count: null, rate_per_activation: '160' },
    ]);
  });

  it('keeps the rate as an exact decimal STRING — never a float (#1)', () => {
    const [only] = parseTierSpec('0+:125.55');
    expect(only.rate_per_activation).toBe('125.55');
    expect(typeof only.rate_per_activation).toBe('string');
  });

  it('tolerates whitespace and trailing separators', () => {
    expect(parseTierSpec(' 0-6 : 110 | 7+ : 125 |')).toHaveLength(2);
  });

  // Delegated to the SAME validateTierBrackets the live API uses, so an imported schedule can never be
  // one the UI would have rejected.
  it.each([
    ['a gap', '0-6:110|8+:125'],
    ['an overlap', '0-10:110|7+:125'],
    ['no open top bracket', '0-6:110|7-16:125'],
    ['two open brackets', '0+:110|7+:125'],
    ['not starting at 0', '1-6:110|7+:125'],
  ])('rejects %s', (_label, spec) => {
    expect(() => parseTierSpec(spec)).toThrow();
  });

  it.each([
    ['an empty cell', ''],
    ['only separators', '||'],
    ['a malformed bracket', '0-6:110|garbage'],
    ['a missing rate', '0-6:|7+:125'],
    ['a non-numeric rate', '0-6:abc|7+:125'],
  ])('rejects %s with an operator-readable message', (_label, spec) => {
    expect(() => parseTierSpec(spec)).toThrow(/tier|expected/i);
  });
});
