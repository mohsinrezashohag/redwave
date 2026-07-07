import { assertFieldDefs, ExpenseFieldDef, parseFieldDefs } from './field-schema.logic';

const def = (over: Partial<ExpenseFieldDef> = {}): ExpenseFieldDef => ({
  key: 'vendor',
  label: 'Vendor',
  type: 'text',
  required: true,
  ...over,
});

describe('assertFieldDefs', () => {
  it('accepts a valid set', () => {
    expect(assertFieldDefs([def(), def({ key: 'city', label: 'City', required: false })])).toEqual([]);
  });

  it('rejects a duplicate key', () => {
    const errors = assertFieldDefs([def(), def({ label: 'Vendor 2' })]);
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects a non-snake_case key and a reserved key', () => {
    expect(assertFieldDefs([def({ key: 'Vendor Name' })]).some((e) => e.includes('snake_case'))).toBe(true);
    expect(assertFieldDefs([def({ key: 'amount' })]).some((e) => e.includes('reserved'))).toBe(true);
  });

  it('rejects a select without options', () => {
    expect(assertFieldDefs([def({ key: 'method', label: 'Method', type: 'select' })]).some((e) => e.includes('option'))).toBe(true);
    expect(assertFieldDefs([def({ key: 'method', label: 'Method', type: 'select', options: ['cash'] })])).toEqual([]);
  });

  it('rejects a soft_cap on a non-numeric field or a bad decimal', () => {
    expect(assertFieldDefs([def({ soft_cap: '20.00' })]).some((e) => e.includes('number/money'))).toBe(true); // text field
    expect(assertFieldDefs([def({ key: 'tip', label: 'Tip', type: 'money', soft_cap: 'abc' })]).some((e) => e.includes('decimal'))).toBe(true);
    expect(assertFieldDefs([def({ key: 'tip', label: 'Tip', type: 'money', soft_cap: '20.00' })])).toEqual([]);
  });
});

describe('parseFieldDefs', () => {
  it('coerces stored jsonb and drops malformed entries', () => {
    const parsed = parseFieldDefs([
      { key: 'vendor', label: 'Vendor', type: 'text', required: true },
      { key: 'bad', label: 'Bad', type: 'nope' }, // unknown type → dropped
      { label: 'no key' }, // missing key → dropped
      'garbage',
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe('vendor');
  });

  it('returns [] for non-array input', () => {
    expect(parseFieldDefs(null)).toEqual([]);
    expect(parseFieldDefs({})).toEqual([]);
  });
});
