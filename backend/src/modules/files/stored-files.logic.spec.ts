import {
  ALLOWED_MIMES,
  buildObjectPath,
  extForMime,
  isAllowedMime,
  MAX_FILE_BYTES,
  purposePrefix,
} from './stored-files.logic';

describe('stored-files.logic — mime allowlist + server-generated paths (security.md file storage)', () => {
  it('allows exactly image/jpeg, image/png, application/pdf', () => {
    expect([...ALLOWED_MIMES]).toEqual(['image/jpeg', 'image/png', 'application/pdf']);
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('image/heic')).toBe(false);
    expect(isAllowedMime('image/gif')).toBe(false);
    expect(isAllowedMime('application/octet-stream')).toBe(false);
  });

  it('caps uploads at 10 MB', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('maps each allowed mime to its storage extension; anything else throws (allowlist gate failed)', () => {
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('application/pdf')).toBe('pdf');
    expect(() => extForMime('image/heic')).toThrow();
  });

  it('builds "{purpose}s/{yyyy}/{mm}/{uuid}.{ext}" — zero-padded month, extension from the MIME', () => {
    const now = new Date(Date.UTC(2026, 5, 13)); // June (month 5 → "06")
    expect(buildObjectPath('receipt', 'image/jpeg', now, 'abc-123')).toBe('receipts/2026/06/abc-123.jpg');
    expect(buildObjectPath('document', 'application/pdf', now, 'def-456')).toBe('documents/2026/06/def-456.pdf');
  });

  it('the path NEVER contains client input (no original filename anywhere)', () => {
    const path = buildObjectPath('receipt', 'image/png', new Date(Date.UTC(2026, 11, 1)), 'u1');
    expect(path).toBe('receipts/2026/12/u1.png');
    expect(path).not.toContain('..');
  });

  it('purposePrefix drives the claim check (receipts/ vs documents/)', () => {
    expect(purposePrefix('receipt')).toBe('receipts/');
    expect(purposePrefix('document')).toBe('documents/');
  });
});
