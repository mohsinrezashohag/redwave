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

// ── Banking (client request 2026-11-12) ─────────────────────────────────────────────────────────────
// Canadian direct deposit: a 3-digit institution number, a 5-digit transit (branch) number and an account
// number of 7–12 digits. Institution + transit are bank routing codes (printed on every cheque), so they are
// stored plainly; the ACCOUNT number is encrypted like the SIN and shown masked.

/** The digits of `input` when they form a valid institution number (3 digits), else null. */
export function normalizeInstitution(input: string): string | null {
  const d = input.replace(/[\s-]/g, '');
  return /^\d{3}$/.test(d) ? d : null;
}

/** The digits of `input` when they form a valid transit number (5 digits), else null. */
export function normalizeTransit(input: string): string | null {
  const d = input.replace(/[\s-]/g, '');
  return /^\d{5}$/.test(d) ? d : null;
}

/** The digits of `input` when they form a valid account number (7–12 digits), else null. */
export function normalizeAccount(input: string): string | null {
  const d = input.replace(/[\s-]/g, '');
  return /^\d{7,12}$/.test(d) ? d : null;
}

/**
 * Canadian financial institutions by their 3-digit number, to pre-fill the bank name (HR can still type any
 * name). Not exhaustive: an unlisted number simply leaves the name for HR to enter. — 2026-11-13
 */
export const CANADIAN_BANKS: Readonly<Record<string, string>> = {
  '001': 'Bank of Montreal (BMO)',
  '002': 'Scotiabank',
  '003': 'RBC Royal Bank',
  '004': 'TD Canada Trust',
  '006': 'National Bank of Canada',
  '010': 'CIBC',
  '016': 'HSBC Bank Canada',
  '030': 'Canadian Western Bank',
  '039': 'Laurentian Bank',
  '219': 'ATB Financial',
  '540': 'Manulife Bank',
  '614': 'Tangerine',
  '621': 'EQ Bank',
  '815': 'Desjardins',
  '828': 'Central 1 Credit Union',
  '837': 'Meridian Credit Union',
};

/** The bank name for an institution number, or null when it isn't in the list. */
export function bankNameFor(institution: string | null | undefined): string | null {
  return institution ? (CANADIAN_BANKS[institution] ?? null) : null;
}

/**
 * The routing number two ways, both derived from the institution + transit (never stored separately):
 *   - electronic (EFT / direct deposit / payroll files): `0` + institution + transit → "000112345";
 *   - cheque (MICR line): transit + "-" + institution → "12345-001".
 */
export function routingNumbers(institution: string | null | undefined, transit: string | null | undefined): { electronic: string; cheque: string } | null {
  if (!institution || !transit) return null;
  return { electronic: `0${institution}${transit}`, cheque: `${transit}-${institution}` };
}

/** "••••4567" from the stored last four; null when none is on file. */
export function maskAccount(last4: string | null | undefined): string | null {
  return last4 ? `••••${last4}` : null;
}
