import { mapToEngineProductType } from './activation-mapping.logic';
import { ProductType } from '../engine/engine.types';

describe('mapToEngineProductType (#9 greenfield at close)', () => {
  it('a greenfield-flagged internet activation maps to greenfield_internet (flat, excluded)', () => {
    expect(mapToEngineProductType('internet', false)).toBe(ProductType.greenfield_internet);
  });
  it('a non-greenfield internet activation stays internet', () => {
    expect(mapToEngineProductType('internet', true)).toBe(ProductType.internet);
  });
  it('tv / home_phone / greenfield_internet pass through unchanged', () => {
    expect(mapToEngineProductType('tv', false)).toBe(ProductType.tv);
    expect(mapToEngineProductType('home_phone', false)).toBe(ProductType.home_phone);
    expect(mapToEngineProductType('greenfield_internet', false)).toBe(
      ProductType.greenfield_internet,
    );
  });
});
