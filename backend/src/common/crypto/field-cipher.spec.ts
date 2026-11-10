import { randomBytes } from 'crypto';
import { decryptField, encryptField, loadFieldKey } from './field-cipher';

const key = randomBytes(32);

describe('field-cipher (AES-256-GCM for PII that must be read back)', () => {
  it('round-trips', () => {
    expect(decryptField(encryptField('046454286', key), key)).toBe('046454286');
  });

  it('never produces the same token twice for the same value (random IV)', () => {
    expect(encryptField('046454286', key)).not.toBe(encryptField('046454286', key));
  });

  it('the token does not contain the clear value', () => {
    expect(encryptField('046454286', key)).not.toContain('046454286');
  });

  it('a tampered token fails instead of decrypting to garbage', () => {
    const [v, iv, tag, ct] = encryptField('046454286', key).split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => decryptField([v, iv, tag, flipped.toString('base64url')].join('.'), key)).toThrow();
  });

  it('the wrong key fails', () => {
    expect(() => decryptField(encryptField('046454286', key), randomBytes(32))).toThrow();
  });

  it('loadFieldKey: null when absent or not 32 bytes — never a silent weak key', () => {
    expect(loadFieldKey({})).toBeNull();
    expect(loadFieldKey({ PII_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toBeNull();
    expect(loadFieldKey({ PII_ENCRYPTION_KEY: key.toString('base64') })?.equals(key)).toBe(true);
  });
});
