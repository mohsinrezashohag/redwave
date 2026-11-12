import { describe, expect, it } from 'vitest';
import { fileKindFromUrl } from './fileKind';

describe('fileKindFromUrl', () => {
  it('reads the kind from the object name, ignoring the signing token', () => {
    expect(fileKindFromUrl('https://x.supabase.co/storage/v1/object/sign/b/rep-docs/2026/a-Passport.PDF?token=abc.pdf.png')).toBe('pdf');
    expect(fileKindFromUrl('https://x.supabase.co/storage/v1/object/sign/b/receipts/2026/11/u.jpeg?token=t')).toBe('image');
    expect(fileKindFromUrl('https://x/y/scan%20copy.png')).toBe('image');
  });
  it('anything else has no preview', () => {
    expect(fileKindFromUrl('https://x/y/sheet.xlsx?token=t')).toBe('other');
    expect(fileKindFromUrl('local://rep-docs/x')).toBe('other');
  });
});
