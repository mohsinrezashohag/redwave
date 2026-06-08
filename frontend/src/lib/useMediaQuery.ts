/**
 * useMediaQuery — subscribe to a CSS media query. Used to drive the responsive app shell
 * (off-canvas nav on mobile, icon rail on tablet). Breakpoints mirror design-system §8.
 */
import { useEffect, useState } from 'react';

// Mobile < 640px · Tablet 640–1024px · Desktop > 1024px (design-system §8).
export const MOBILE_MAX = '(max-width: 639.98px)';
export const TABLET_RANGE = '(min-width: 640px) and (max-width: 1023.98px)';

export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync in case the query changed between render and effect
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True below the tablet breakpoint (phones) — the sidebar becomes an off-canvas drawer. */
export const useIsMobile = (): boolean => useMediaQuery(MOBILE_MAX);

/** True in the tablet band — the sidebar is forced to the icon rail. */
export const useIsTablet = (): boolean => useMediaQuery(TABLET_RANGE);
