import { cleanMappedRow, coerceDate, coerceMoney, normCode, normWs, coerceInt } from './clean.logic';

describe('clean.logic — coerceDate', () => {
  it('passes ISO through, formats a Date by its UTC calendar day (no shift)', () => {
    expect(coerceDate('2026-03-12')).toBe('2026-03-12');
    expect(coerceDate(new Date('2026-03-12T00:00:00.000Z'))).toBe('2026-03-12');
  });
  it('parses North-American M/D/Y and 2-digit years', () => {
    expect(coerceDate('3/12/2026')).toBe('2026-03-12');
    expect(coerceDate('03/05/26')).toBe('2026-03-05');
  });
  it('parses an Excel serial number', () => {
    expect(coerceDate('45728')).toBe('2025-03-12'); // 45728 = 2025-03-12
  });
  it('returns null for blank/garbage', () => {
    expect(coerceDate('')).toBeNull();
    expect(coerceDate(null)).toBeNull();
    expect(coerceDate('not a date')).toBeNull();
  });
});

describe('clean.logic — coerceMoney (exact decimal string, never float)', () => {
  it('strips $ and commas, pads to 2dp', () => {
    expect(coerceMoney('$1,234.5')).toBe('1234.50');
    expect(coerceMoney('60')).toBe('60.00');
    expect(coerceMoney('993.00')).toBe('993.00');
  });
  it('handles accounting negatives', () => {
    expect(coerceMoney('(145.00)')).toBe('-145.00');
  });
  it('null for blank/garbage', () => {
    expect(coerceMoney('')).toBeNull();
    expect(coerceMoney('abc')).toBeNull();
  });
});

describe('clean.logic — normCode (kills the VF/Vf inconsistency)', () => {
  it('trims + upper-cases', () => {
    expect(normCode('  vf ')).toBe('VF');
    expect(normCode('Vf')).toBe('VF');
    expect(normCode('rw-d-0001')).toBe('RW-D-0001');
  });
});

describe('clean.logic — normWs / coerceInt', () => {
  it('trims, empty → null', () => {
    expect(normWs('  hi ')).toBe('hi');
    expect(normWs('   ')).toBeNull();
  });
  it('coerceInt strips separators', () => {
    expect(coerceInt('1,000')).toBe('1000');
    expect(coerceInt('x')).toBeNull();
  });
});

describe('clean.logic — cleanMappedRow', () => {
  it('cleans each field by its declared type; unknown fields trim only', () => {
    const out = cleanMappedRow(
      { client_code: ' vf ', amount: '$60', sale_date: '3/12/2026', note: '  hi ' },
      { client_code: 'code', amount: 'money', sale_date: 'date' },
    );
    expect(out).toEqual({ client_code: 'VF', amount: '60.00', sale_date: '2026-03-12', note: 'hi' });
  });
});
