/**
 * ID document checks — PURE (no Nest, no I/O). — client request 2026-11-12
 *
 * When Gemini has read an uploaded ID (passport, PR card, permit, licence), these rules turn what it read
 * into CONSISTENCY CHECKS that HR sees before confirming the dates. They do NOT prove a document is genuine
 * (nothing can, from a photo); they catch a wrong person's document, impossible dates, an expired document,
 * and a machine-readable strip (MRZ) whose built-in check digits don't add up — the classic sign of a typo
 * or an edited passport/PR card. MRZ rules: ICAO Doc 9303 (TD3 = passport, 2×44; TD1 = card, 3×30).
 */

export interface IdCheck {
  key: 'name' | 'dates' | 'not_expired' | 'dob' | 'mrz' | 'mrz_expiry';
  ok: boolean;
  message: string;
}

/** 'YYYY-MM-DD' that is a real calendar date. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A date the model returned, kept only when it is a real 'YYYY-MM-DD' (never guessed or repaired). */
export function cleanDate(value: unknown): string | null {
  return typeof value === 'string' && isIsoDate(value.trim()) ? value.trim() : null;
}

/** ICAO 9303 check digit: weights 7,3,1 repeating; 0-9 = value, A-Z = 10-35, '<' = 0. */
export function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    const ch = field[i];
    let v = 0;
    if (ch >= '0' && ch <= '9') v = ch.charCodeAt(0) - 48;
    else if (ch >= 'A' && ch <= 'Z') v = ch.charCodeAt(0) - 55;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

const digitOk = (field: string, check: string) => /^\d$/.test(check) && mrzCheckDigit(field) === Number(check);

/** MRZ 'YYMMDD' expiry → 'YYYY-MM-DD' (expiries are this century). Null when not a real date. */
function mrzExpiry(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const iso = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * MRZ 'YYMMDD' birth date → 'YYYY-MM-DD'. A birth year can't be in the future, so a 2-digit year above this
 * year's is the 1900s. Null when not a real date.
 */
function mrzBirth(yymmdd: string, todayYear: number): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const century = 2000 + yy > todayYear ? '19' : '20';
  const iso = `${century}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return isIsoDate(iso) ? iso : null;
}

/** The document number as printed in the MRZ, without the '<' filler. Null when blank. */
function mrzDocNumber(field: string): string | null {
  const n = field.replace(/</g, '').trim();
  return n.length > 0 ? n : null;
}

export interface MrzResult {
  format: 'TD3' | 'TD1';
  /** Every check digit (document number, birth date, expiry, composite) adds up. */
  valid: boolean;
  expires_on: string | null;
  date_of_birth: string | null;
  document_number: string | null;
}

/**
 * Read a passport (TD3) or card (TD1) MRZ. Null when the lines aren't a recognisable MRZ. `today` ('YYYY-MM-DD')
 * places a 2-digit birth year in the right century.
 */
export function parseMrz(lines: string[] | null | undefined, today = '2026-01-01'): MrzResult | null {
  const todayYear = Number(today.slice(0, 4));
  const clean = (lines ?? []).map((l) => l.toUpperCase().replace(/\s+/g, '')).filter((l) => l.length > 0);
  if (clean.length === 2 && clean.every((l) => l.length === 44)) {
    const l2 = clean[1];
    const valid =
      digitOk(l2.slice(0, 9), l2[9]) &&
      digitOk(l2.slice(13, 19), l2[19]) &&
      digitOk(l2.slice(21, 27), l2[27]) &&
      digitOk(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), l2[43]);
    return {
      format: 'TD3',
      valid,
      expires_on: mrzExpiry(l2.slice(21, 27)),
      date_of_birth: mrzBirth(l2.slice(13, 19), todayYear),
      document_number: mrzDocNumber(l2.slice(0, 9)),
    };
  }
  if (clean.length === 3 && clean.every((l) => l.length === 30)) {
    const [l1, l2] = clean;
    const valid =
      digitOk(l1.slice(5, 14), l1[14]) &&
      digitOk(l2.slice(0, 6), l2[6]) &&
      digitOk(l2.slice(8, 14), l2[14]) &&
      digitOk(l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29), l2[29]);
    return {
      format: 'TD1',
      valid,
      expires_on: mrzExpiry(l2.slice(8, 14)),
      date_of_birth: mrzBirth(l2.slice(0, 6), todayYear),
      document_number: mrzDocNumber(l1.slice(5, 14)),
    };
  }
  return null;
}

/** Upper-case, accent-free name words (ignores single letters and punctuation). */
function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length > 1);
}

/**
 * The document's name and the rep's refer to the same person: every word of the shorter name appears in
 * the longer one, in any order ("RIVERA, Riley Ann" vs "Riley Rivera" matches; "Jordan Field" does not).
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return short.every((t) => long.has(t));
}

export interface ReadDocument {
  name_on_document: string | null;
  issued_on: string | null;
  expires_on: string | null;
  /** Read off the document (2026-11-13), else taken from the MRZ when that is present. */
  date_of_birth?: string | null;
  document_number?: string | null;
  mrz_lines: string[] | null;
}

/** Fill the birth date / document number from the MRZ when the printed text gave none. */
export function withMrzDetails(read: ReadDocument, today: string): ReadDocument {
  const mrz = parseMrz(read.mrz_lines, today);
  return {
    ...read,
    date_of_birth: read.date_of_birth ?? mrz?.date_of_birth ?? null,
    document_number: read.document_number ?? mrz?.document_number ?? null,
  };
}

/** The checks HR sees beside the dates. `today` is 'YYYY-MM-DD' (Winnipeg). */
export function idDocumentChecks(
  read: ReadDocument,
  repName: string,
  today: string,
  repDateOfBirth: string | null = null,
): IdCheck[] {
  const checks: IdCheck[] = [];

  if (read.name_on_document) {
    const ok = namesMatch(read.name_on_document, repName);
    checks.push({
      key: 'name',
      ok,
      message: ok
        ? `Name on the document (${read.name_on_document}) matches this rep.`
        : `Name on the document (${read.name_on_document}) doesn’t match this rep (${repName}).`,
    });
  }

  if (read.issued_on || read.expires_on) {
    const problems: string[] = [];
    if (read.issued_on && read.issued_on > today) problems.push('the issue date is in the future');
    if (read.issued_on && read.expires_on && read.issued_on >= read.expires_on) problems.push('it expires before it was issued');
    checks.push({
      key: 'dates',
      ok: problems.length === 0,
      message: problems.length === 0 ? 'The dates are consistent.' : `The dates don’t add up: ${problems.join(', and ')}.`,
    });
  }

  if (read.expires_on) {
    const ok = read.expires_on >= today;
    checks.push({ key: 'not_expired', ok, message: ok ? 'The document hasn’t expired.' : 'The document has expired.' });
  }

  if (read.date_of_birth && repDateOfBirth) {
    const ok = read.date_of_birth === repDateOfBirth;
    checks.push({
      key: 'dob',
      ok,
      message: ok
        ? 'The date of birth matches this rep’s profile.'
        : `The date of birth on the document (${read.date_of_birth}) differs from the profile (${repDateOfBirth}).`,
    });
  }

  const mrz = parseMrz(read.mrz_lines, today);
  if (mrz) {
    checks.push({
      key: 'mrz',
      ok: mrz.valid,
      message: mrz.valid
        ? 'The machine-readable strip checks out.'
        : 'The machine-readable strip’s check digits don’t add up. Look at the document closely.',
    });
    if (mrz.expires_on && read.expires_on) {
      const ok = mrz.expires_on === read.expires_on;
      checks.push({
        key: 'mrz_expiry',
        ok,
        message: ok
          ? 'The printed expiry matches the machine-readable strip.'
          : `The printed expiry (${read.expires_on}) differs from the machine-readable strip (${mrz.expires_on}).`,
      });
    }
  }
  return checks;
}
