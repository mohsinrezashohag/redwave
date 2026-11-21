import { describe, expect, it } from 'vitest';
import { bankNameFor, isValidSin, loginOptions, NONE, repFormDefaults, repFormSchema, routingNumbers, toCreateBody, toUpdateBody, type RepFormValues } from './repForm';

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

describe('bank name + routing (2026-11-13)', () => {
  it('suggests the bank for a known institution and derives both routing forms', () => {
    expect(bankNameFor('004')).toBe('TD Canada Trust');
    expect(bankNameFor('999')).toBeNull();
    expect(routingNumbers('004', '12-345')).toEqual({ electronic: '000412345', cheque: '12345-004' });
    expect(routingNumbers('04', '12345')).toBeNull();
  });

  it('sends the bank name and holder only when typed', () => {
    const body = toUpdateBody(base({ bank_institution: '004', bank_transit: '12345', bank_name: ' TD ', bank_account_holder: 'Riley' }), true);
    expect(body).toMatchObject({ banking: { institution_no: '004', transit_no: '12345', bank_name: 'TD', account_holder: 'Riley' } });
    expect((toUpdateBody(base({ bank_institution: '004', bank_transit: '12345' }), true) as { banking: object }).banking).not.toHaveProperty('bank_name');
  });
});

describe('linked login (2026-11-16)', () => {
  const users = [
    { id: 'u1', full_name: 'Ann', email: 'a@x.ca', status: 'active' },
    { id: 'u2', full_name: 'Bob', email: 'b@x.ca', status: 'active' },
    { id: 'u3', full_name: 'Cy', email: 'c@x.ca', status: 'inactive' },
  ];
  it('lists None then active logins not linked to another rep', () => {
    const opts = loginOptions(users, new Map([['u2', { id: 'r-other' }]]), null);
    expect(opts.map((o) => o.value)).toEqual([NONE, 'u1']);
  });
  it("keeps the rep's own login, even when inactive", () => {
    const opts = loginOptions(users, new Map([['u3', { id: 'r1' }]]), { id: 'r1', user_id: 'u3' });
    expect(opts.map((o) => o.value)).toContain('u3');
  });
  it('NONE sends no user_id on create and null on update; a picked id is sent', () => {
    const base = repFormDefaults(null);
    expect('user_id' in toCreateBody({ ...base, user_id: NONE } as RepFormValues)).toBe(false);
    expect(toCreateBody({ ...base, user_id: 'u1' } as RepFormValues)).toMatchObject({ user_id: 'u1' });
    expect(toUpdateBody({ ...base, user_id: NONE } as RepFormValues, false)).toMatchObject({ user_id: null });
  });
});
