/**
 * app-link — the SINGLE source for every user-facing link the backend builds (reset-password, invite,
 * temp-password sign-in, and any future notification-email deep link). Pure + framework-free (unit-tested
 * without Nest). `APP_BASE_URL` is the canonical env var; the legacy `APP_URL` is honored as a DEPRECATED
 * alias. Dev defaults to the Vite origin so local dev needs no setup; PRODUCTION HAS NO DEFAULT — unset or
 * invalid resolves to null and the mailer refuses to send link-bearing emails (fail-safe: never email a
 * localhost link to a real user). — AUTH-002
 */

export const DEV_APP_BASE_URL = 'http://localhost:5173';

export interface AppBaseUrlEnv {
  NODE_ENV?: string;
  APP_BASE_URL?: string;
  APP_URL?: string;
}

export interface ResolvedAppBaseUrl {
  /** The normalized origin/base (no trailing slash), or null = prod fail-safe (links can't be built). */
  baseUrl: string | null;
  source: 'APP_BASE_URL' | 'APP_URL' | 'dev-default' | null;
}

/** Trim + validate (http/https only — anything else counts as unset) + strip trailing slashes. */
function normalize(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return value.replace(/\/+$/, '');
}

export function resolveAppBaseUrl(env: AppBaseUrlEnv): ResolvedAppBaseUrl {
  const canonical = normalize(env.APP_BASE_URL);
  if (canonical) return { baseUrl: canonical, source: 'APP_BASE_URL' };

  const legacy = normalize(env.APP_URL);
  if (legacy) return { baseUrl: legacy, source: 'APP_URL' };

  if (env.NODE_ENV !== 'production') {
    return { baseUrl: DEV_APP_BASE_URL, source: 'dev-default' }; // zero-setup local dev
  }
  // PRODUCTION + nothing valid → no default. The caller must fail safe (refuse, never localhost).
  return { baseUrl: null, source: null };
}

/** Join base + path with exactly one slash, plus properly-encoded query params. */
export function appLink(baseUrl: string, path: string, params?: Record<string, string>): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const query = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
  return `${base}${p}${query}`;
}
