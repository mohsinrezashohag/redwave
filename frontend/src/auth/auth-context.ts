import { createContext } from 'react';
import type { ThemePreference } from '../theme/theme.types';
import type { PublicUser } from './auth.types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** What a login produced: a full session, or an MFA challenge that must be redeemed via verifyMfa. */
export type LoginOutcome = { kind: 'ok' } | { kind: 'mfa'; mfaToken: string };

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  roles: string[];
  /** Effective permissions as `"module:action"` strings (union of the user's roles, from /me). */
  permissions: Set<string>;
  isSuperAdmin: boolean;
  /** The caller's linked rep id, or null. The backend defines "is a rep" by this — drives rep landing. */
  repId: string | null;
  /** When true, policy requires the user to enrol in MFA before using the app (from /me). */
  mfaEnrollmentRequired: boolean;
  /** Password step. Resolves to {kind:'mfa'} when a second factor is required (no session issued yet). */
  login: (email: string, password: string) => Promise<LoginOutcome>;
  /** Second factor — redeem the mfa challenge token + a TOTP/recovery code for a session. */
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  /** Re-fetch /me (e.g. after enrolling MFA so the enrollment gate clears). */
  reloadMe: () => Promise<void>;
  logout: () => Promise<void>;
  /** Set the theme: applies instantly; persists to the server (PATCH /v1/account/theme) when authed. */
  setTheme: (preference: ThemePreference) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
