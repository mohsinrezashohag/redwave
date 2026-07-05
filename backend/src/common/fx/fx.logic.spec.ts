import { Decimal } from 'decimal.js';
import { convertToCad } from './fx.logic';

describe('convertToCad — frozen FX conversion (half-up, #12)', () => {
  it('CAD rate=1 is the identity (2 dp)', () => {
    expect(convertToCad('42.50', '1').toFixed(2)).toBe('42.50');
    expect(convertToCad('0.01', '1').toFixed(2)).toBe('0.01');
  });

  it('applies a realistic USD→CAD rate', () => {
    // 100.00 USD × 1.36500000 = 136.50 CAD
    expect(convertToCad('100.00', '1.36500000').toFixed(2)).toBe('136.50');
  });

  // The rounding-boundary case: a rate that produces a .xx5 THIRD decimal must round HALF-UP (not
  // half-even), else a real rounding bug hides here. 10.00 × 1.3625 = 13.625 → 13.63 (half-up), NOT 13.62.
  it('rounds a .xx5 third-decimal HALF-UP, not half-even', () => {
    // Both cases have an EVEN 2nd decimal + a 3rd decimal of exactly 5, so half-even would round DOWN;
    // half-up must round UP. 10.00 × 1.3625 = 13.625 → 13.63 (not 13.62); 2.00 × 1.3625 = 2.725 → 2.73.
    expect(convertToCad('10.00', '1.3625').toFixed(2)).toBe('13.63');
    expect(convertToCad('2.00', '1.3625').toFixed(2)).toBe('2.73');
  });

  it('returns an exact Decimal (never a float)', () => {
    expect(convertToCad('33.33', '1.365')).toBeInstanceOf(Decimal);
  });
});
