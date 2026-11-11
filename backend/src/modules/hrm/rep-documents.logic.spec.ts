import { repDocumentProblem } from './rep-documents.logic';
import { maskAccount, normalizeAccount, normalizeInstitution, normalizeTransit } from './rep-profile.logic';

describe('rep document rules (2026-11-12)', () => {
  it('accepts the known types with a suitable file', () => {
    expect(repDocumentProblem('passport', 'application/pdf', '2031-04-30')).toBeNull();
    expect(repDocumentProblem('banking', 'image/jpeg', undefined)).toBeNull();
    expect(repDocumentProblem('headshot', 'image/png', undefined)).toBeNull();
  });

  it('a headshot must be a JPG or PNG — not a PDF or WEBP', () => {
    expect(repDocumentProblem('headshot', 'application/pdf', undefined)).toMatch(/JPG or PNG/);
    expect(repDocumentProblem('headshot', 'image/webp', undefined)).toMatch(/JPG or PNG/);
  });

  it('an expiry date only on documents that expire', () => {
    expect(repDocumentProblem('contract', 'application/pdf', '2027-01-01')).toMatch(/expiry/);
    expect(repDocumentProblem('work_permit', 'application/pdf', '2027-01-01')).toBeNull();
  });

  it('an unknown type is refused', () => {
    expect(repDocumentProblem('selfie', 'image/png', undefined)).toMatch(/Unknown document type/);
  });
});

describe('banking number rules', () => {
  it('institution 3 digits, transit 5, account 7–12 (spaces / dashes allowed)', () => {
    expect(normalizeInstitution('001')).toBe('001');
    expect(normalizeInstitution('01')).toBeNull();
    expect(normalizeTransit('12-345')).toBe('12345');
    expect(normalizeTransit('1234')).toBeNull();
    expect(normalizeAccount('1234 567')).toBe('1234567');
    expect(normalizeAccount('123456')).toBeNull();
    expect(normalizeAccount('1234567890123')).toBeNull();
  });

  it('masks to the last four', () => {
    expect(maskAccount('4567')).toBe('••••4567');
    expect(maskAccount(null)).toBeNull();
  });
});
