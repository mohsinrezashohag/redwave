import { splitServiceAddress } from './address.logic';

describe('splitServiceAddress (VF/CTI bill sheets, 2026-11-28)', () => {
  it('splits street, city, province and postal code', () => {
    expect(splitServiceAddress('430 Lake Ave, Lac du Bonnet, MB R0E 1A0')).toEqual({
      street: '430 Lake Ave',
      city: 'Lac du Bonnet',
      province_state: 'MB',
      postal_code: 'R0E 1A0',
    });
  });

  it('handles no postal code, a postal code without a space, and a province name', () => {
    expect(splitServiceAddress('28 Heather Way, Lac du Bonnet, MB')).toMatchObject({ city: 'Lac du Bonnet', province_state: 'MB', postal_code: null });
    expect(splitServiceAddress('1 Main St, Winnipeg, MB R3C1A1')).toMatchObject({ postal_code: 'R3C 1A1' });
    expect(splitServiceAddress('1 Main St, Winnipeg, Manitoba')).toMatchObject({ province_state: 'MB' });
  });

  it('keeps earlier comma parts in the street', () => {
    expect(splitServiceAddress('Unit 9, 472 Loren Dr, Morgan, MB')).toMatchObject({ street: 'Unit 9, 472 Loren Dr', city: 'Morgan' });
  });

  it('returns null when the shape is not recognisable (the cell is kept as written)', () => {
    expect(splitServiceAddress('28 Heather Way')).toBeNull();
    expect(splitServiceAddress('351-399 Gardener Rd')).toBeNull();
    expect(splitServiceAddress('63035, Seven Sisters Falls')).toBeNull();
    expect(splitServiceAddress('1 Main St, Somewhere, Narnia')).toBeNull();
    expect(splitServiceAddress(null)).toBeNull();
  });
});

describe('splitServiceAddress: rural RF shapes', () => {
  it('a land location + province has no town', () => {
    expect(splitServiceAddress('SW 1/4 24-50-27 W2, SK')).toEqual({ street: 'SW 1/4 24-50-27 W2', city: null, province_state: 'SK', postal_code: null });
  });
  it('a bracketed land location after the province moves to the street', () => {
    expect(splitServiceAddress('111 Klassen St W, Warman, SK (SW 13-40-5 W3)')).toEqual({
      street: '111 Klassen St W (SW 13-40-5 W3)', city: 'Warman', province_state: 'SK', postal_code: null,
    });
  });
  it('a rural municipality is kept beside the town, not used as it', () => {
    expect(splitServiceAddress('302 Poplar Point, Martins Lake, RM of Leask No. 464, SK')).toMatchObject({
      street: '302 Poplar Point', city: 'Martins Lake (RM of Leask No. 464)', province_state: 'SK',
    });
    // An RM that is the only locality stays the city.
    expect(splitServiceAddress('34050 Mile 73N, RM of Brokenhead, MB')).toMatchObject({ street: '34050 Mile 73N', city: 'RM of Brokenhead' });
  });
});

describe('splitServiceAddress: sales-app (geocoder) shapes, 2026-11-28', () => {
  it('drops the country, takes a postal code in its own part, and collapses "Town of <town>"', () => {
    expect(splitServiceAddress('4709, 55 Avenue, Vermilion, Town of Vermilion, Alberta, T9X 1G2, Canada')).toEqual({
      street: '4709, 55 Avenue', city: 'Vermilion', province_state: 'AB', postal_code: 'T9X 1G2',
    });
  });
  it('reads a full province name', () => {
    expect(splitServiceAddress('4709 55 AVE, VERMILION, Alberta')).toEqual({ street: '4709 55 AVE', city: 'VERMILION', province_state: 'AB', postal_code: null });
  });
});
