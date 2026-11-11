import { describe, expect, it } from 'vitest';
import { isValidSin, NONE, repFormDefaults, repFormSchema, toCreateBody, toUpdateBody, type RepFormValues } from './repForm';

const TODAY = '2026-11-11';
const base = (over: Partial<RepFormValues> = {}): RepFormValues => ({
  ...repFormDefaults(null),
  rep_code: 'RW-0100',
  full_name: 'Jordan Field',
  field_manager_id: 'mgr-1',
  hire_date: '2026-01-15',
  ...over,
});
const errorsOf = (mode: 'create' | 'edit', v: RepFormValues) => {
  const r = repFormSchema(mode, TODAY).safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('isValidSin — mirrors the server Luhn check', () => {
  it('accepts the published test SIN with or without separators', () => {
    expect(isValidSin('046 454 286')).toBe(true);
    expect(isValidSin('046-454-286')).toBe(true);
  });
  it('rejects a bad checksum or wrong length', () => {
    expect(isValidSin('046 454 287')).toBe(false);
    expect(isValidSin('12345678')).toBe(false);
  });
});

describe('repFormSchema', () => {
  it('a minimal valid rep passes', () => {
    expect(errorsOf('create', base())).toEqual({});
  });
  it('flags a bad SIN, postal code, future DOB and email inline', () => {
    const e = errorsOf('create', base({ sin: '123', address_postal: '12345', date_of_birth: '2999-01-01', email: 'nope' }));
    expect(Object.keys(e).sort()).toEqual(['address_postal', 'date_of_birth', 'email', 'sin']);
  });
  // A real user typed 786543219 (9 digits, fails the check digit). The message must say how to fix it.
  it('explains WHICH SIN problem it is: wrong length vs. a failed check digit', () => {
    expect(errorsOf('create', base({ sin: '12345' })).sin).toMatch(/exactly 9 digits/);
    expect(errorsOf('create', base({ sin: '786543219' })).sin).toMatch(/check digit/);
    expect(errorsOf('create', base({ sin: '046 454 286' }))).not.toHaveProperty('sin');
  });

  it('rep code is required on create only (immutable after)', () => {
    expect(errorsOf('create', base({ rep_code: '' }))).toHaveProperty('rep_code');
    expect(errorsOf('edit', base({ rep_code: '' }))).toEqual({});
  });
  it('terminating requires a termination date', () => {
    expect(errorsOf('edit', base({ status: 'terminated' }))).toHaveProperty('termination_date');
  });
});

describe('form → body', () => {
  it('blank optionals become null, the "not set" sentinel becomes null, a blank SIN is OMITTED', () => {
    const body = toUpdateBody(base({ phone: '  ', jacket_size: NONE, sin: '' })) as Record<string, unknown>;
    expect(body.phone).toBeNull();
    expect(body.jacket_size).toBeNull();
    expect(body).not.toHaveProperty('sin'); // keep the SIN on file
  });
  it('a typed SIN is sent; rep_code is sent on create but never on edit', () => {
    expect(toCreateBody(base({ sin: '046 454 286' }))).toMatchObject({ rep_code: 'RW-0100', sin: '046 454 286' });
    expect(toUpdateBody(base())).not.toHaveProperty('rep_code');
  });
  it('the SIN is never pre-filled from a rep', () => {
    expect(repFormDefaults({ sin_masked: '••• ••• 286' } as never).sin).toBe('');
  });
});

describe('banking (2026-11-12)', () => {
  const bankErrors = (v: RepFormValues, accountOnFile = false) => {
    const r = repFormSchema('edit', TODAY, accountOnFile).safeParse(v);
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
  };

  it('checks the digit counts the server enforces', () => {
    const e = bankErrors(base({ bank_institution: '01', bank_transit: '1234', bank_account: '123' }));
    expect(Object.keys(e).sort()).toEqual(['bank_account', 'bank_institution', 'bank_transit']);
    expect(bankErrors(base({ bank_institution: '001', bank_transit: '12-345', bank_account: '1234 567' }))).toEqual({});
  });

  it('is all-or-nothing; a blank account is fine only when one is on file', () => {
    expect(bankErrors(base({ bank_institution: '001' }))).toHaveProperty('bank_transit');
    expect(bankErrors(base({ bank_institution: '001', bank_transit: '12345' }))).toHaveProperty('bank_account');
    expect(bankErrors(base({ bank_institution: '001', bank_transit: '12345' }), true)).toEqual({});
  });

  it('builds the body: omitted, kept, replaced or cleared', () => {
    expect(toCreateBody(base())).not.toHaveProperty('banking');
    expect(toUpdateBody(base({ bank_institution: '001', bank_transit: '12345' }), true)).toMatchObject({
      banking: { institution_no: '001', transit_no: '12345' },
    });
    expect((toUpdateBody(base({ bank_institution: '001', bank_transit: '12345' }), true) as { banking: object }).banking).not.toHaveProperty('account_no');
    expect(toUpdateBody(base({ bank_institution: '001', bank_transit: '12345', bank_account: '1234567' }))).toMatchObject({
      banking: { account_no: '1234567' },
    });
    expect(toUpdateBody(base(), true)).toMatchObject({ banking: null });
    expect(toUpdateBody(base(), false)).not.toHaveProperty('banking');
  });
});
