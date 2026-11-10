/**
 * Rep profile rules — PURE (no Nest, no Prisma). — client request 2026-11-11 · SRS HRM-001/008
 *
 * SIN: a Canadian Social Insurance Number is 9 digits whose Luhn checksum is valid. Accepted with spaces or
 * dashes, stored as 9 bare digits (encrypted), shown only as "••• ••• 789".
 */

/** The sizes offered for jacket and t-shirt. */
export const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;

/** Canadian province / territory codes. */
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** 9 bare digits when the input is a valid SIN (Luhn), else null. */
export function normalizeSin(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(digits)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? digits : null;
}

/** "046454286" → "046 454 286" (the revealed form). */
export function formatSin(digits: string): string {
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** The masked form, from the stored last three digits; null when no SIN is on file. */
export function maskSin(last3: string | null): string | null {
  return last3 ? `••• ••• ${last3}` : null;
}

/** "r3t2n2" / "R3T-2N2" → "R3T 2N2"; null when it is not a Canadian postal code. */
export function normalizePostal(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : null;
}
