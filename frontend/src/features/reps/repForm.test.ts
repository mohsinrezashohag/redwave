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
