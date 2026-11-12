import { describe, expect, it } from 'vitest';
import { acceptFor, docTypeLabel, EXPIRING_DOC_TYPES, expiryStatus } from './repDocTypes';

describe('rep document kinds', () => {
  it('labels known types and shows an older free-text type as written', () => {
    expect(docTypeLabel('drivers_licence')).toBe("Driver's licence");
    expect(docTypeLabel('banking')).toBe('Banking');
    expect(docTypeLabel('Photo ID (old)')).toBe('Photo ID (old)');
  });

  it('a headshot accepts JPG/PNG only', () => {
    expect(acceptFor('headshot')).toBe('image/jpeg,image/png');
    expect(acceptFor('passport')).toContain('application/pdf');
  });

  it('only permits, PR card, licence and passport expire', () => {
    expect(EXPIRING_DOC_TYPES.has('work_permit')).toBe(true);
    expect(EXPIRING_DOC_TYPES.has('contract')).toBe(false);
  });
});

describe('expiryStatus', () => {
  const TODAY = '2026-11-12';
  it('expired, expiring within 60 days, or fine', () => {
    expect(expiryStatus('2026-11-01', TODAY)).toEqual({ kind: 'expired', days: 11 });
    expect(expiryStatus('2026-12-12', TODAY)).toEqual({ kind: 'soon', days: 30 });
    expect(expiryStatus('2026-11-12', TODAY)).toEqual({ kind: 'soon', days: 0 });
    expect(expiryStatus('2027-06-30', TODAY)).toEqual({ kind: 'ok' });
    expect(expiryStatus(null, TODAY)).toBeNull();
  });

  it('reads the date part of a timestamp (the API sends DATE as an ISO string)', () => {
    expect(expiryStatus('2026-12-12T00:00:00.000Z', TODAY)).toEqual({ kind: 'soon', days: 30 });
  });
});

describe('reading notes and date rules', () => {
  it('explains each failure in plain words', async () => {
    const { readFailureNote, datesProblem } = await import('./repDocTypes');
    expect(readFailureNote({ status: 503 })).toMatch(/isn’t set up/);
    const e = Object.assign(new Error('This file is too large to read. Enter the dates by hand.'), { status: 422 });
    expect(readFailureNote(e)).toMatch(/too large/);
    expect(readFailureNote(new Error('boom'))).toMatch(/Couldn’t read/);
    expect(datesProblem('2030-01-01', '2029-01-01')).toMatch(/after the issue date/);
    expect(datesProblem('', '2029-01-01')).toBeNull();
  });
});
