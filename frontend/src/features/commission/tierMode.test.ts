import { describe, expect, it } from 'vitest';
import { deriveTierMode, isBasePriceSchedule } from './tierMode';
import type { TierConfig } from './commission.types';

const bracket = (tier_number: number, min_count: number, max_count: number | null) =>
  ({ tier_number, min_count, max_count, rate_per_activation: '145.00' }) as TierConfig['tiers'][number];
const cfg = (status: TierConfig['status'], tiers: TierConfig['tiers'], client_id: string | null = null) =>
  ({ id: `${status}-${tiers.length}`, client_id, status, tiers }) as TierConfig;

const LADDER = [bracket(4, 0, 6), bracket(3, 7, 16), bracket(2, 17, 35), bracket(1, 36, null)];
const BASE = [bracket(1, 0, null)];

describe('tier mode', () => {
  it('one bracket covering every count is BASE PRICES; a ladder is TIERS', () => {
    expect(isBasePriceSchedule({ tiers: BASE })).toBe(true);
    expect(isBasePriceSchedule({ tiers: LADDER })).toBe(false);
    expect(isBasePriceSchedule({ tiers: [bracket(1, 5, null)] })).toBe(false);
  });

  it("reads the scope's CURRENT schedule (server status), not a past or pending one", () => {
    const m = deriveTierMode(false, [cfg('past', LADDER), cfg('current', BASE), cfg('pending', LADDER)], undefined);
    expect(m.mode).toBe('base_prices');
    expect(m.inherited).toBe(false);
  });

  it('a client with no schedule of its own FOLLOWS Global', () => {
    const m = deriveTierMode(true, [], [cfg('current', BASE)]);
    expect(m).toMatchObject({ mode: 'base_prices', inherited: true });
  });

  it("a client's own schedule wins over Global", () => {
    const m = deriveTierMode(true, [cfg('current', LADDER, 'c1')], [cfg('current', BASE)]);
    expect(m).toMatchObject({ mode: 'tiers', inherited: false });
  });

  it('nothing in force → no mode', () => {
    expect(deriveTierMode(false, [cfg('pending', BASE)], undefined).mode).toBeNull();
  });
});
