import { cleanDate, idDocumentChecks, isIsoDate, mrzCheckDigit, namesMatch, parseMrz } from './id-document.logic';

// ICAO 9303 specimen passport (Anna Maria Eriksson, Utopia) — the standard published example.
const TD3 = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
// ICAO 9303 specimen TD1 card.
const TD1 = ['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'];

describe('MRZ check digits (ICAO 9303)', () => {
  it('computes the published check digits', () => {
    expect(mrzCheckDigit('L898902C3')).toBe(6);
    expect(mrzCheckDigit('740812')).toBe(2);
    expect(mrzCheckDigit('120415')).toBe(9);
  });

  it('accepts the specimen passport and card, and reads the expiry', () => {
    expect(parseMrz(TD3)).toEqual({ format: 'TD3', valid: true, expires_on: '2012-04-15' });
    expect(parseMrz(TD1)).toEqual({ format: 'TD1', valid: true, expires_on: '2012-04-15' });
  });

  it('flags a tampered strip (one digit of the expiry changed)', () => {
    const edited = [TD3[0], TD3[1].replace('1204159', '1304159')];
    expect(parseMrz(edited)?.valid).toBe(false);
  });

  it('is null for anything that is not an MRZ', () => {
    expect(parseMrz(['hello'])).toBeNull();
    expect(parseMrz(null)).toBeNull();
  });
});

describe('dates and names', () => {
  it('keeps only real YYYY-MM-DD dates (never repairs a guess)', () => {
    expect(isIsoDate('2027-02-28')).toBe(true);
    expect(isIsoDate('2027-02-30')).toBe(false);
    expect(cleanDate(' 2030-01-01 ')).toBe('2030-01-01');
    expect(cleanDate('01/01/2030')).toBeNull();
    expect(cleanDate(42)).toBeNull();
  });

  it('matches names in any order, ignoring accents and punctuation', () => {
    expect(namesMatch('RIVERA, Riley Ann', 'Riley Rivera')).toBe(true);
    expect(namesMatch('José Álvarez', 'Jose Alvarez')).toBe(true);
    expect(namesMatch('Jordan Field', 'Riley Rivera')).toBe(false);
    expect(namesMatch(null, 'Riley Rivera')).toBe(false);
  });
});

describe('idDocumentChecks', () => {
  const TODAY = '2026-11-12';

  it('a consistent, valid document passes every check', () => {
    const checks = idDocumentChecks(
      { name_on_document: 'Anna Maria Eriksson', issued_on: '2002-04-16', expires_on: '2012-04-15', mrz_lines: TD3 },
      'Anna Eriksson',
      '2010-01-01',
    );
    expect(checks.map((c) => [c.key, c.ok])).toEqual([
      ['name', true],
      ['dates', true],
      ['not_expired', true],
      ['mrz', true],
      ['mrz_expiry', true],
    ]);
  });

  it('flags another person, impossible dates and an expired document', () => {
    const checks = idDocumentChecks(
      { name_on_document: 'Jordan Field', issued_on: '2027-01-01', expires_on: '2026-01-01', mrz_lines: null },
      'Riley Rivera',
      TODAY,
    );
    expect(checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(['name', 'dates', 'not_expired']);
    expect(checks.find((c) => c.key === 'dates')?.message).toMatch(/future.*expires before/);
  });

  it('says nothing about what was not read', () => {
    expect(idDocumentChecks({ name_on_document: null, issued_on: null, expires_on: null, mrz_lines: null }, 'X Y', TODAY)).toEqual([]);
  });
});
