/**
 * Possible-duplicate detection at sale entry — PURE (no Nest, no Prisma, no clock).
 *
 * Until 2026-11-28 a sale was flagged only when its client + MPU ID matched an existing sale, but most sales
 * carry no MPU (RF Now never sends one), so two entries for the same household went through silently. The
 * client asked (App Review Feedback, High #3): "flag a matching name or address as a possible duplicate, and
 * flag conflicting values, for admin review. Don't block the submission." So a sale is FLAGGED when, for the
 * same client, another live sale has the same MPU, the same street address + city, or the same customer
 * name. A flag never blocks entry; it holds the sale for review (§14 rule 8).
 *
 * Matching is deliberately literal after folding (case, accents, punctuation, common street-type
 * abbreviations): a false positive costs one approval click, a guess that two different spellings are the
 * same person costs nothing because nothing is ever refused.
 */

export type DuplicateReason = 'mpu' | 'address' | 'name';

export interface DuplicateInput {
  customer_name: string | null | undefined;
  street: string | null | undefined;
  city: string | null | undefined;
  mpu_id: string | null | undefined;
}

export interface DuplicateCandidate extends DuplicateInput {
  id: string;
  sale_code: string;
}

export interface DuplicateMatch {
  id: string;
  sale_code: string;
  reason: DuplicateReason;
}

/** Lowercase, strip accents, collapse every non-alphanumeric run to one space, trim. */
export function foldText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip accents (combining marks) after NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Street-type words a rep and a partner file spell differently ("Drive" vs "Dr"). */
const STREET_WORDS: Record<string, string> = {
  street: 'st',
  avenue: 'ave',
  av: 'ave',
  road: 'rd',
  drive: 'dr',
  boulevard: 'blvd',
  crescent: 'cres',
  court: 'ct',
  place: 'pl',
  lane: 'ln',
  terrace: 'terr',
  highway: 'hwy',
  circle: 'cir',
  trail: 'trl',
  parkway: 'pkwy',
  square: 'sq',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northwest: 'nw',
  northeast: 'ne',
  southwest: 'sw',
  southeast: 'se',
};

/** Street + city folded to one comparable key, or null when the street is blank (an import's '—'). */
export function addressKey(street: string | null | undefined, city: string | null | undefined): string | null {
  const folded = foldText(street);
  if (folded === '') return null;
  const streetKey = folded
    .split(' ')
    .map((w) => STREET_WORDS[w] ?? w)
    .join(' ');
  return `${streetKey}|${foldText(city)}`;
}

/**
 * The customer's folded full name, or null when it is too thin to compare: a single word ("John") would flag
 * half the book, so a name needs at least two words to count.
 */
export function nameKey(name: string | null | undefined): string | null {
  const folded = foldText(name);
  return folded.split(' ').filter(Boolean).length >= 2 ? folded : null;
}

/**
 * The first candidate (callers pass them oldest first, so this is the ORIGINAL) that duplicates the input,
 * with the strongest reason: MPU, then address, then name. Null when none does.
 */
export function findDuplicate(input: DuplicateInput, candidates: DuplicateCandidate[]): DuplicateMatch | null {
  const mpu = foldText(input.mpu_id);
  const address = addressKey(input.street, input.city);
  const name = nameKey(input.customer_name);

  const firstWhere = (reason: DuplicateReason, test: (c: DuplicateCandidate) => boolean): DuplicateMatch | null => {
    const hit = candidates.find(test);
    return hit ? { id: hit.id, sale_code: hit.sale_code, reason } : null;
  };

  return (
    (mpu !== '' ? firstWhere('mpu', (c) => foldText(c.mpu_id) === mpu) : null) ??
    (address !== null ? firstWhere('address', (c) => addressKey(c.street, c.city) === address) : null) ??
    (name !== null ? firstWhere('name', (c) => nameKey(c.customer_name) === name) : null)
  );
}

/** The leading house number of a street ("123 Main St" → "123"), used to narrow the candidate query. */
export function houseNumber(street: string | null | undefined): string | null {
  const m = /^\s*(\d+[a-z]?)\b/i.exec(street ?? '');
  return m ? m[1] : null;
}

/** Plain words for the reason, for notifications and the review screen. */
export function duplicateReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'address':
      return 'the same address';
    case 'name':
      return 'the same customer name';
    default:
      return 'the same MPU ID';
  }
}
