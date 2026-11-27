import { addressKey, duplicateReasonText, findDuplicate, houseNumber, nameKey } from './sale-duplicate.logic';

const original = {
  id: 'orig',
  sale_code: '2026-11-01-VF',
  customer_name: 'Mark Thibault',
  street: '23 Shoreline Drive',
  city: 'Winnipeg',
  mpu_id: null,
};

describe('findDuplicate (App Review Feedback High #3, 2026-11-28)', () => {
  it('flags the same address even when the street type is spelled differently', () => {
    const hit = findDuplicate({ customer_name: 'Someone Else', street: '23 shoreline dr.', city: 'WINNIPEG', mpu_id: null }, [original]);
    expect(hit).toEqual({ id: 'orig', sale_code: '2026-11-01-VF', reason: 'address' });
  });

  it('flags the same customer name at a different address', () => {
    const hit = findDuplicate({ customer_name: 'mark  thibault', street: '9 Other Rd', city: 'Brandon', mpu_id: null }, [original]);
    expect(hit?.reason).toBe('name');
  });

  it('prefers MPU, then address, then name', () => {
    const byMpu = { ...original, id: 'mpu', mpu_id: 'MPU-1' };
    const hit = findDuplicate({ customer_name: 'Mark Thibault', street: '23 Shoreline Dr', city: 'Winnipeg', mpu_id: 'mpu-1' }, [original, byMpu]);
    expect(hit).toMatchObject({ id: 'mpu', reason: 'mpu' });
  });

  it('does not flag a different household', () => {
    expect(findDuplicate({ customer_name: 'Ana Lopez', street: '24 Shoreline Drive', city: 'Winnipeg', mpu_id: null }, [original])).toBeNull();
  });

  it('ignores one-word names and blank streets (too thin to compare)', () => {
    const thin = { ...original, customer_name: 'Mark', street: '—' };
    expect(findDuplicate({ customer_name: 'Mark', street: '—', city: 'Winnipeg', mpu_id: null }, [thin])).toBeNull();
  });

  it('returns the first (oldest) candidate', () => {
    const later = { ...original, id: 'later' };
    expect(findDuplicate({ ...original, mpu_id: null }, [original, later])?.id).toBe('orig');
  });
});

describe('helpers', () => {
  it('builds keys and house numbers', () => {
    expect(addressKey('100 Innovation Drive', 'Winnipeg')).toBe('100 innovation dr|winnipeg');
    expect(addressKey('  ', 'Winnipeg')).toBeNull();
    expect(nameKey('Élise  Côté')).toBe('elise cote');
    expect(houseNumber('12B Main St')).toBe('12B');
    expect(houseNumber('Main St')).toBeNull();
    expect(duplicateReasonText('address')).toBe('the same address');
    expect(duplicateReasonText(null)).toBe('the same MPU ID');
  });
});
