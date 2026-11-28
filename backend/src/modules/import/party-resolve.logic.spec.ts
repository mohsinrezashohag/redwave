import { resolveClientRef, resolveRepRef } from './party-resolve.logic';

const clients = [
  { client_code: 'NLF', name: 'Northern Lights Fiber' },
  { client_code: 'VF', name: 'Valley Fiber' },
];
const reps = [
  { rep_code: 'RW023', external_code: 'REDWAVE23', full_name: 'Adnan Saquib' },
  { rep_code: 'RW004', external_code: 'REDWAVE04', full_name: 'Md Shahidur Rahman Shifat' },
  { rep_code: 'RW016', external_code: 'REDWAVE16', full_name: 'Mir Adil Mahmud' },
  { rep_code: 'RW017', external_code: 'REDWAVE17', full_name: 'Md Jubair Hossain' },
  { rep_code: 'RW050', external_code: null, full_name: 'Md Rahman' },
  { rep_code: 'RW051', external_code: null, full_name: 'Ali Rahman' },
];

describe('resolveClientRef (sold report workspace, 2026-11-28)', () => {
  it('matches a code, an exact name, or the one client the cell starts with', () => {
    expect(resolveClientRef('nlf', clients)).toBe('NLF');
    expect(resolveClientRef('Valley Fiber', clients)).toBe('VF');
    expect(resolveClientRef('Northern Lights Fiber - Redwave', clients)).toBe('NLF');
    expect(resolveClientRef('Somebody Else', clients)).toBeNull();
  });
});

describe('resolveRepRef (never a guess)', () => {
  it('prefers codes', () => {
    expect(resolveRepRef('Redwave23', reps)).toEqual({ kind: 'code', rep_code: 'RW023' });
  });
  it('matches a whole name ignoring spaces and case', () => {
    expect(resolveRepRef('adnansaquib', reps)).toMatchObject({ kind: 'name', rep_code: 'RW023' });
    expect(resolveRepRef('Mir adil mahmud', reps)).toMatchObject({ kind: 'name', rep_code: 'RW016' });
  });
  it('matches when every word belongs to exactly one rep', () => {
    expect(resolveRepRef('Rahman Shifat', reps)).toMatchObject({ kind: 'name', rep_code: 'RW004' });
    expect(resolveRepRef('Jubair Hossain', reps)).toMatchObject({ kind: 'name', rep_code: 'RW017' });
  });
  it('reports ambiguity and unknowns instead of picking', () => {
    expect(resolveRepRef('Rahman', reps)).toEqual({ kind: 'none' }); // one word is too thin
    expect(resolveRepRef('Md Rahman Ali', reps)).toEqual({ kind: 'none' });
    expect(resolveRepRef('Abdul Malak', reps)).toEqual({ kind: 'none' });
    const twoMd = [...reps, { rep_code: 'RW099', external_code: null, full_name: 'Md Jubair Hossain Khan' }];
    expect(resolveRepRef('Jubair Hossain', twoMd)).toMatchObject({ kind: 'ambiguous' });
  });
});
