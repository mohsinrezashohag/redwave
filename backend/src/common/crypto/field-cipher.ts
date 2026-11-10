/**
 * Field-level encryption for PII that must be READ BACK (unlike passwords, which are one-way hashed).
 * First user: the rep SIN. — client request 2026-11-11 · docs/security.md §8
 *
 * AES-256-GCM: a random 96-bit IV per value and a 128-bit auth tag, so identical SINs never produce the same
 * token and any tampering with the stored value fails to decrypt (rather than decrypting to garbage).
 * Token format: `v1.<iv>.<tag>.<ciphertext>` (base64url) — the version prefix lets a future key rotation tell
 * old tokens from new ones.
 *
 * The 32-byte key lives in the env (`PII_ENCRYPTION_KEY`, base64) on the server — NEVER in the database, so a
 * database dump alone reveals no SIN. Pure Node `crypto`; no Nest, no Prisma.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * The key from the env, or null when it is absent or not exactly 32 bytes. Callers treat null as
 * "PII storage not configured" and refuse to store or reveal — they never fall back to plain text.
 */
export function loadFieldKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = (env.PII_ENCRYPTION_KEY ?? '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptField(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Throws on a malformed token, a wrong key, or any tampering (GCM authentication). */
export function decryptField(token: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = token.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('unrecognised encrypted field format');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
