/**
 * AuthProvider — the source of truth for the authenticated session in React. Boots by trying to
 * restore the session (refresh → /me); exposes login / logout / setTheme; holds the user + effective
 * permissions. Permissions drive ROUTING and UI convenience-gating ONLY — the server is the real gate
 * (CLAUDE §5). Closes the theme loop: applies the user's saved theme on login and persists changes via
 * PATCH /v1/account/theme. — SRS §4, design-system §3.5
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { queryClient } from '../lib/query/queryClient';
import { useTheme } from '../theme/useTheme';
import type { ThemePreference } from '../theme/theme.types';
import { AuthContext, type AuthStatus } from './auth-context';
import type { LoginResponse, MeResponse, PublicUser } from './auth.types';
import {
  clearSession,
  getRefreshToken,
  onSessionExpired,
  refreshAccessToken,
  REFRESH_STORAGE_KEY,
  setAccessToken,
  setSession,
} from './session';

// The backend OpenAPI declares no response schemas, so openapi-fetch types `data` as `never`. The
// JSON IS parsed at runtime; we cast to the hand-written contract types (see auth.types.ts).
const asData = <T,>(data: unknown): T => data as T;

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setPreference } = useTheme();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [repId, setRepId] = useState<string | null>(null);
  const booted = useRef(false);

  const clearLocal = useCallback(() => {
    setUser(null);
    setRoles([]);
    setPermissions(new Set());
    setIsSuperAdmin(false);
    setRepId(null);
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
    setStatus('authenticated');
    // Apply the user's saved theme locally (it IS the server value — no PATCH back). — §3.5
    setPreference(me.user.theme_preference);
  }, [setPreference]);

  // ── Boot: restore an existing session ─────────────────────────────────────────────
  useEffect(() => {
    if (booted.current) return; // guard StrictMode double-mount
    booted.current = true;
    let cancelled = false;
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      if (!getRefreshToken()) {
        if (!cancelled) setStatus('unauthenticated');
        return;
      }
      // Ride out a backend cold start: retry the refresh a few times on TRANSIENT failures (5xx/network).
      let result = await refreshAccessToken();
      for (let attempt = 0; !result.ok && !result.expired && attempt < 4; attempt += 1) {
        await delay(2000);
        if (cancelled) return;
        result = await refreshAccessToken();
      }
      if (cancelled) return;
      if (!result.ok) {
        // expired → real logout (the refresh token is dead; clearSession already ran in doRefresh).
        // transient (the backend never woke) → KEEP the refresh token (no clearSession) so a reload
        // recovers once it's up; just show the login screen for now.
        clearLocal();
        return;
      }
      try {
        await loadMe();
      } catch {
        // /me failed — most likely a transient 5xx (a genuine 401 would have refreshed+retried inside the
        // client). Do NOT destroy the session: keep the refresh token, show login; a reload recovers.
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
      if (e.key === REFRESH_STORAGE_KEY && e.newValue === null) {
        setAccessToken(null);
        clearLocal();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [clearLocal]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data, error, response } = await api.POST('/v1/auth/login', { body: { email, password } });
      if (!response.ok) {
        // Surface the server message (e.g. the lockout notice); fall back to the generic credential error.
        const msg = (error as { error?: { message?: string } } | undefined)?.error?.message;
        throw new Error(msg ?? 'Invalid credentials');
      }
      const tokens = asData<LoginResponse>(data);
      setSession(tokens.access_token, tokens.refresh_token);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await api.POST('/v1/auth/logout'); // best-effort audit; ignore failures
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
    () => ({ status, user, roles, permissions, isSuperAdmin, repId, login, logout, setTheme }),
    [status, user, roles, permissions, isSuperAdmin, repId, login, logout, setTheme],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
