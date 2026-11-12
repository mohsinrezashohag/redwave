/**
 * Browser tab titles from the breadcrumb trail (2026-11-12): the page, its parent, then the app, e.g.
 * "Riley Rivera · Reps · Redwave". Every route already declares its crumb, so every page gets a title with
 * no per-page code. A detail page's record name resolves like its crumb does and is reported back through
 * `CrumbTitleContext`.
 */
import { createContext } from 'react';

export const APP_TITLE = 'Redwave';

/** Display-order trail labels (root → leaf) → "Leaf · Parent · Redwave". Blank labels are skipped. */
export function pageTitle(trail: (string | null | undefined)[]): string {
  const named = trail.filter((t): t is string => !!t && t.trim().length > 0);
  return [...named.slice(-2).reverse(), APP_TITLE].join(' · ');
}

/** A dynamic crumb reports its resolved record name here so the tab title can use it. */
export const CrumbTitleContext = createContext<((label: string | null) => void) | null>(null);
