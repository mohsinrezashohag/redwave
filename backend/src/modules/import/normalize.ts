/**
 * The ONE normalisation rule shared by column-name matching (`suggest-mapping.logic`) and cell-value
 * matching (`value-vocabulary.logic`). Kept in its own module so the two can never drift apart — a header
 * alias and a vocabulary label must fold the same way, or a file that maps cleanly can still fail to
 * classify (exactly the `"Internet, TV"` defect). — SRS §15 IMP-004
 */

/** Lowercase, collapse every non-alphanumeric run to a single space, trim. `"Home  Phone!"` → `"home phone"`. */
export function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `normalizeToken` with spaces removed — folds `home_phone` / `Home Phone` / `homephone` onto one form. */
export function squashToken(s: string): string {
  return normalizeToken(s).replace(/ /g, '');
}
