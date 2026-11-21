import { describe, expect, it } from 'vitest';
import { cityOptions, isListedCity, OTHER_CITY, REGION_CODES, regionOptions, resolveRegion } from './regions';

describe('regions (mirrors backend common/geo/regions)', () => {
  it('lists Canada first, with unique codes', () => {
    expect(regionOptions()[0].value).toBe('AB');
    expect(REGION_CODES).toContain('MB');
    expect(new Set(REGION_CODES).size).toBe(REGION_CODES.length);
  });

  it('Manitoba cities lead with Winnipeg and always end with Other', () => {
    const opts = cityOptions('MB');
    expect(opts[0].value).toBe('Winnipeg');
    expect(opts.map((o) => o.value)).toEqual(expect.arrayContaining(['Brandon', 'Steinbach', 'Thompson']));
    expect(opts[opts.length - 1].value).toBe(OTHER_CITY);
    expect(cityOptions('WY')).toEqual([{ value: OTHER_CITY, label: 'Other' }]);
  });

  it('resolves a legacy full name to its code, and recognises listed cities', () => {
    expect(resolveRegion('Manitoba')).toBe('MB');
    expect(isListedCity('MB', 'winnipeg')).toBe(true);
    expect(isListedCity('MB', 'Lac du Bonnet')).toBe(false);
  });
});
