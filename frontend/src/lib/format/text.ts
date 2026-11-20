/**
 * text — tiny display helpers for labels. Pure, no React.
 */

/** Fold a label for comparison: case, accents, spacing and punctuation are ignored. */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * True when two labels say the same thing ("TV" vs "tv", "Home Phone" vs "home-phone"), so a screen can skip
 * printing the second one ("TV · TV"). A missing value never matches. 2026-11-18
 */
export function sameLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const fa = fold(a);
  return fa !== '' && fa === fold(b);
}

/** Join display parts with " · ", dropping blanks and any part that repeats an earlier one. */
export function joinDistinct(parts: Array<string | null | undefined>, sep = ' · '): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || !p.trim()) continue;
    if (out.some((o) => sameLabel(o, p))) continue;
    out.push(p.trim());
  }
  return out.join(sep);
}
