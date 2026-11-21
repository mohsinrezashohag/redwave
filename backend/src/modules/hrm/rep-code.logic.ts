/**
 * Rep code rules — PURE (no Nest, no Prisma). — client meeting 2026-11-16 ("rep creations not recorded after
 * REDWAVE15")
 *
 *   - NATURAL ORDER: rep codes are text with a number in them (REDWAVE2, REDWAVE10). A plain text sort puts
 *     REDWAVE10..19 before REDWAVE2, so a newly added rep landed on a different page of the roster and looked
 *     as if it had not been saved. `compareRepCodes` compares the digit runs as numbers, case-insensitively.
 *   - CODE CLASHES: imports resolve a rep by EITHER rep_code or external_code (CLAUDE §14 rule 9), so a value
 *     may not be one rep's rep_code and another rep's partner code. `codeClashMessage` names the exact clash.
 */

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural, case-insensitive comparison: REDWAVE2 < REDWAVE10 < redwave11. Ties fall back to plain order. */
export function compareRepCodes(a: string, b: string): number {
  return COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Sort rows by rep_code naturally (id breaks exact ties, so paging is stable). Returns a new array. */
export function sortByRepCode<T extends { id: string; rep_code: string }>(rows: T[], dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => sign * (compareRepCodes(x.rep_code, y.rep_code) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)));
}

/** The other rep a code collides with. */
export interface ClashingRep {
  rep_code: string;
  external_code: string | null;
  full_name: string;
  status: string;
}

const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const who = (rep: ClashingRep) => `${rep.rep_code} (${rep.full_name}${rep.status === 'terminated' ? ', terminated' : ''})`;

/**
 * The 409 message for a code that collides with `other`, or null when it does not. `field` is the code being
 * written: the new rep's rep_code, or a (new or edited) partner code.
 */
export function codeClashMessage(field: 'rep_code' | 'external_code', value: string, other: ClashingRep): string | null {
  const label = field === 'rep_code' ? 'Rep code' : 'Partner code';
  if (same(other.rep_code, value)) {
    return field === 'rep_code'
      ? `Rep code ${value} is already used by ${who(other)}. Codes are never reused, including those of terminated reps.`
      : `Partner code ${value} is the rep code of ${who(other)}. Imports match a rep by either code, so they can’t overlap.`;
  }
  if (same(other.external_code, value)) {
    return field === 'rep_code'
      ? `Rep code ${value} is already the partner code of ${who(other)}. Imports match a rep by either code, so they can’t overlap.`
      : `${label} ${value} is already used by ${who(other)}.`;
  }
  return null;
}

/** The 409 message when a login is already linked to another rep. */
export function loginClashMessage(other: ClashingRep): string {
  return `That login is already linked to ${who(other)}. Unlink it there first; a login belongs to one rep.`;
}
