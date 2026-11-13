import { bankNameFor, formatSin, maskSin, normalizePostal, normalizeSin, routingNumbers } from './rep-profile.logic';

describe('rep profile rules', () => {
  it('accepts a valid SIN with spaces or dashes and returns bare digits', () => {
    // 046 454 286 is the Government of Canada's published test SIN (valid Luhn).
    expect(normalizeSin('046 454 286')).toBe('046454286');
    expect(normalizeSin('046-454-286')).toBe('046454286');
  });

  it('rejects a SIN that fails Luhn or is not 9 digits', () => {
    expect(normalizeSin('046 454 287')).toBeNull();
    expect(normalizeSin('12345678')).toBeNull();
    expect(normalizeSin('04645428a')).toBeNull();
  });

  it('formats and masks', () => {
    expect(formatSin('046454286')).toBe('046 454 286');
    expect(maskSin('286')).toBe('••• ••• 286');
    expect(maskSin(null)).toBeNull();
  });

  it('normalizes a Canadian postal code', () => {
    expect(normalizePostal('r3t2n2')).toBe('R3T 2N2');
    expect(normalizePostal('R3T-2N2')).toBe('R3T 2N2');
    expect(normalizePostal('12345')).toBeNull();
  });
});

describe('banking details (2026-11-13)', () => {
  it('names the bank from its institution number, and nothing for an unknown one', () => {
    expect(bankNameFor('004')).toBe('TD Canada Trust');
    expect(bankNameFor('815')).toBe('Desjardins');
    expect(bankNameFor('999')).toBeNull();
    expect(bankNameFor(null)).toBeNull();
  });

  it('derives both routing numbers from institution + transit', () => {
    expect(routingNumbers('004', '12345')).toEqual({ electronic: '000412345', cheque: '12345-004' });
    expect(routingNumbers('004', null)).toBeNull();
  });
});
