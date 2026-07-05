/**
 * AuthProvider — the source of truth for the authenticated session in React. Boots by trying to restore
 * the session (cookie refresh → /me); exposes login / verifyMfa / logout / setTheme; holds the user +
 * effective permissions. Permissions drive ROUTING and UI convenience-gating ONLY — the server is the real
 * gate (CLAUDE §5). The refresh token is an httpOnly cookie (never in JS); CSRF rides a readable cookie the
 * client echoes. — SRS §4, arch §security
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { queryClient } from '../lib/query/queryClient';
import { useTheme } from '../theme/useTheme';
import type { ThemePreference } from '../theme/theme.types';
import { AuthContext, type AuthStatus, type LoginOutcome } from './auth-context';
import type { LoginResponse, MeResponse, PublicUser } from './auth.types';
import {
  clearSession,
  LOGOUT_PING_KEY,
  onSessionExpired,
  refreshAccessToken,
  setAccessToken,
  setSession,
} from './session';

// The generated types model nullable/optional fields; we cast the parsed JSON to the contract types.
const asData = <T,>(data: unknown): T => data as T;

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setPreference } = useTheme();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [repId, setRepId] = useState<string | null>(null);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);

  const clearLocal = useCallback(() => {
    setUser(null);
    setRoles([]);
    setPermissions(new Set());
    setIsSuperAdmin(false);
    setRepId(null);
    setMfaEnrollmentRequired(false);
    setStatus('unauthenticated');
  }, []);

  const loadMe = useCallback(async () => {
    const { data, response } = await api.GET('/v1/auth/me');
    if (!response.ok) {
      throw new Error('Failed to load profile');
    }
    const me = asData<MeResponse>(data);
    setUser(me.user);
    setRoles(me.roles);
    setPermissions(new Set(me.effective_permissions));
    setIsSuperAdmin(me.is_super_admin);
    setRepId(me.rep_id);
    setMfaEnrollmentRequired(Boolean(me.mfa_enrollment_required));
    setStatus('authenticated');
    // Apply the user's saved theme locally (it IS the server value — no PATCH back). — §3.5
    setPreference(me.user.theme_preference);
  }, [setPreference]);

  // ── Boot: restore an existing session (the refresh cookie, if any) ────────────────
  // No `booted` ref guard: under React StrictMode (dev) the effect runs setup→cleanup→setup, and a ref
  // guard would let cleanup #1 cancel the FIRST run while the guard blocks the SECOND from completing —
  // leaving `status` stuck on 'loading' forever (a dev-only deadlock). Instead each run has its OWN
  // `cancelled` flag: the cleaned-up run discards, the live run finishes and sets `status`. The network
  // is deduped by the single-flight `refreshAccessToken()` (session.ts), so the double-invoke still makes
  // ONE /auth/refresh (+ one /me). deps are stable (loadMe/clearLocal are useCallback) → runs once on mount.
  useEffect(() => {
    let cancelled = false;
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      // No readable refresh token any more — just ATTEMPT a refresh. A logged-out boot 401s (definitive)
      // → unauthenticated; a logged-in boot rotates the cookie → /me.
      let result = await refreshAccessToken();
      // Ride out a backend cold start: retry on TRANSIENT failures (5xx/network) only.
      for (let attempt = 0; !result.ok && !result.expired && attempt < 4; attempt += 1) {
        await delay(2000);
        if (cancelled) return;
        result = await refreshAccessToken();
      }
      if (cancelled) return;
      if (!result.ok) {
        clearLocal(); // expired → logged out; transient → show login, a reload recovers once the API is up
        return;
      }
      try {
        await loadMe();
      } catch {
        if (!cancelled) clearLocal();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe, clearLocal]);

  // ── Session-expired (in-session refresh failure) + multi-tab logout sync ───────────
  useEffect(() => {
    onSessionExpired(() => clearLocal());
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOGOUT_PING_KEY) {
        setAccessToken(null);
        clearLocal();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [clearLocal]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const { data, error, response } = await api.POST('/v1/auth/login', { body: { email, password } });
      if (!response.ok) {
        // Surface the server message (e.g. the lockout notice); fall back to the generic credential error.
        const msg = (error as { error?: { message?: string } } | undefined)?.error?.message;
        throw new Error(msg ?? 'Invalid credentials');
      }
      const res = asData<LoginResponse>(data);
      if (res.mfa_required && res.mfa_token) {
        return { kind: 'mfa', mfaToken: res.mfa_token }; // no session yet — caller shows the code step
      }
      setSession(res.access_token ?? '');
      await loadMe();
      return { kind: 'ok' };
    },
    [loadMe],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const { data, error, response } = await api.POST('/v1/auth/mfa/verify', { body: { mfa_token: mfaToken, code } });
      if (!response.ok) {
        const msg = (error as { error?: { message?: string } } | undefined)?.error?.message;
        throw new Error(msg ?? 'Invalid authentication code');
      }
      const res = asData<LoginResponse>(data);
      setSession(res.access_token ?? '');
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await api.POST('/v1/auth/logout'); // revokes the session + clears the cookies server-side
    } catch {
      // ignore
    }
    clearSession();
    clearLocal();
    queryClient.clear(); // drop all cached server-state so the next session starts clean
  }, [clearLocal]);

  const setTheme = useCallback(
    (preference: ThemePreference) => {
      setPreference(preference); // instant local apply + localStorage
      if (status === 'authenticated') {
        // Persist per-user so the choice follows the user across devices. — §3.5
        api.PATCH('/v1/account/theme', { body: { theme_preference: preference } }).catch(() => {});
      }
    },
    [setPreference, status],
  );

  const value = useMemo(
    () => ({ status, user, roles, permissions, isSuperAdmin, repId, mfaEnrollmentRequired, login, verifyMfa, reloadMe: loadMe, logout, setTheme }),
    [status, user, roles, permissions, isSuperAdmin, repId, mfaEnrollmentRequired, login, verifyMfa, loadMe, logout, setTheme],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
