import { describe, expect, it } from 'vitest';
import { actionLabel, describeChanges, fieldLabel, formatValue } from './historyDiff';

describe('describeChanges', () => {
  it('reads a status change as words and hides nothing that matters', () => {
    expect(describeChanges({ status: 'entered' }, { status: 'validated', is_greenfield: false })).toEqual([
      { field: 'Status', before: 'Entered', after: 'Validated' },
      { field: 'Greenfield', before: null, after: 'No' },
    ]);
  });

  it('leaves internal ids out of a create (the screenshot case)', () => {
    const after = {
      rep_id: '95c47b58-ded5-49e2-9c7a-82f0d2ae10de',
      client_id: '02ea0016-485f-4af7-aa99-1ac77b721166',
      status: 'entered',
      sale_code: '2026-11-15-CTI',
      item_count: 2,
      is_greenfield: false,
      duplicate_of_sale_id: null,
    };
    expect(describeChanges(null, after)).toEqual([
      { field: 'Status', before: null, after: 'Entered' },
      { field: 'Sale ID', before: null, after: '2026-11-15-CTI' },
      { field: 'Products', before: null, after: '2' },
      { field: 'Greenfield', before: null, after: 'No' },
    ]);
  });

  it('keeps a business code whose key ends in _id (MPU ID)', () => {
    expect(describeChanges(null, { mpu_id: 'MPU-3291' })).toEqual([{ field: 'MPU ID', before: null, after: 'MPU-3291' }]);
  });

  it('skips fields whose readable value did not change', () => {
    expect(describeChanges({ city: 'Edmonton' }, { city: 'Edmonton' })).toEqual([]);
  });
});

describe('labels and values', () => {
  it('humanises actions and fields', () => {
    expect(actionLabel('validate')).toBe('Validated');
    expect(actionLabel('approve_duplicate')).toBe('Duplicate approved');
    expect(actionLabel('bulk_review')).toBe('Bulk review');
    expect(fieldLabel('customer_first_name')).toBe('Customer first name');
    expect(fieldLabel('mpu_id')).toBe('MPU ID');
  });
  it('formats dates, booleans, blanks and lists', () => {
    expect(formatValue('2026-11-15T00:00:00.000Z')).toBe('2026-11-15');
    expect(formatValue(true)).toBe('Yes');
    expect(formatValue('')).toBeNull();
    expect(formatValue(['internet', 'tv'])).toBe('Internet, TV');
    expect(formatValue('2026-11-15T17:43:56.000Z')).toBe('2026-11-15 17:43');
    expect(formatValue('Edmonton')).toBe('Edmonton');
  });
});
