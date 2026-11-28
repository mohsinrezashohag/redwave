/**
 * Product-name matching for imports — PURE. A bill sheet names the exact plan ("Fibre 1gig/2.5gig"), and the
 * import must attach THAT product, not the first product of its type: the billing rate is per product (#3),
 * and a rep rate may be too (#5). Names are compared folded (case, accents, spacing and punctuation), so
 * "Fibre 1Gig / 2.5Gig" still matches. — 2026-11-28
 */
export function foldName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip accents (combining marks) after NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
