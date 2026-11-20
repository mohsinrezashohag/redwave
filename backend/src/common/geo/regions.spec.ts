import { isRegionCode, normaliseRegionLenient, REGION_CODES, resolveRegion, splitCityRegion } from './regions';

describe('regions', () => {
  it('holds every Canadian province/territory and every US state, with unique codes', () => {
    expect(REGION_CODES).toContain('MB');
    expect(REGION_CODES).toContain('YT');
    expect(REGION_CODES).toContain('ND');
    expect(new Set(REGION_CODES).size).toBe(REGION_CODES.length);
  });

  it('resolves a code or a full name (case and accents ignored) to the code', () => {
    expect(resolveRegion('mb')).toBe('MB');
    expect(resolveRegion(' Manitoba ')).toBe('MB');
    expect(resolveRegion('Québec')).toBe('QC');
    expect(resolveRegion('north dakota')).toBe('ND');
    expect(resolveRegion('Narnia')).toBeNull();
    expect(resolveRegion('')).toBeNull();
  });

  it('isRegionCode accepts codes only', () => {
    expect(isRegionCode('ON')).toBe(true);
    expect(isRegionCode('Ontario')).toBe(false);
  });

  it('the lenient import form keeps unknown text instead of failing', () => {
    expect(normaliseRegionLenient('Manitoba')).toBe('MB');
    expect(normaliseRegionLenient('Somewhere')).toBe('Somewhere');
    expect(normaliseRegionLenient('  ')).toBeNull();
    expect(normaliseRegionLenient(null)).toBeNull();
  });
});

describe('splitCityRegion (2026-11-18: "Edmonton, AB, AB")', () => {
  it('drops a trailing province that matches the sale province, by code or name', () => {
    expect(splitCityRegion('Edmonton, AB', 'AB')).toEqual({ city: 'Edmonton', region: 'AB' });
    expect(splitCityRegion('Winnipeg , manitoba', 'MB')).toEqual({ city: 'Winnipeg', region: 'MB' });
  });
  it('fills the region when no province was given', () => {
    expect(splitCityRegion('Edmonton, AB', null)).toEqual({ city: 'Edmonton', region: 'AB' });
    expect(splitCityRegion('Edmonton, AB', '—')).toEqual({ city: 'Edmonton', region: 'AB' });
  });
  it('leaves the city alone when the suffix is not a region or disagrees with the province', () => {
    expect(splitCityRegion('Edmonton', 'AB')).toEqual({ city: 'Edmonton', region: null });
    expect(splitCityRegion('Saint-Jean, Quartier Nord', 'QC')).toEqual({ city: 'Saint-Jean, Quartier Nord', region: null });
    expect(splitCityRegion('Kenora, ON', 'MB')).toEqual({ city: 'Kenora, ON', region: null });
  });
  it('passes null through', () => {
    expect(splitCityRegion(null, 'AB')).toEqual({ city: null, region: null });
  });
});
