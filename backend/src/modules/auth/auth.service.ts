/**
 * AuthService — login, refresh, logout, and the /me identity payload.
 *
 * Login returns a generic error on any failure (bad email, wrong password, inactive account)
 * so it never reveals which part failed. Passwords are verified with bcryptjs; the hash is
 * never returned. — SRS AUTH-001/005/008, CLAUDE §3 (passwords)
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { USER_PUBLIC_SELECT } from '../../common/util/user-public';
import { newCsrfToken } from '../../common/security/cookie.util';
import { TokenService } from './token.service';
import { RefreshSessionService } from './refresh-session.service';
import { MfaService } from './mfa.service';
import { AvatarService } from '../../common/avatar/avatar.service';

/** What login produced: a full session, or an MFA challenge that must be redeemed first. */
export interface SessionTokens {
  /** The opaque rotating refresh token for the httpOnly cookie. */
  refresh_token: string;
  /** The double-submit CSRF token for the readable cookie. */
  csrf_token: string;
  access_token: string;
}
export type LoginOutcome =
  | ({ kind: 'tokens'; must_change_password: boolean; mfa_enrollment_required: boolean } & SessionTokens)
  | { kind: 'mfa_required'; mfa_token: string };

const intCfg = (config: ConfigService, key: string, fallback: number): number => {
  const raw = config.get<string>(key);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: RefreshSessionService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly avatars: AvatarService,
  ) {}

  async login(email: string, password: string, req?: Request): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Generic failure — do not disclose whether the email exists or is inactive.
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Brute-force lockout: refuse while the account is locked (the only non-generic message — it helps a
    // genuine user being targeted, and the attacker already knows the email). — SRS AUTH-002 (lockout)
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new UnauthorizedException('Account temporarily locked after too many failed attempts. Try again later or reset your password.');
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failed_login_attempts);
      throw new UnauthorizedException('Invalid credentials');
    }
    // Success → clear any failure counter / lock.
    if (user.failed_login_attempts > 0 || user.locked_until) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failed_login_attempts: 0, locked_until: null } });
    }

    // Second factor (TOTP). If the user is enrolled we require a code BEFORE any session is issued.
    // If policy requires MFA but they're NOT yet enrolled we still issue a session (so they aren't locked
    // out mid-cycle) and flag enrollment — the UI forces it, mirroring must_change_password. — AUTH MFA
    const gate = await this.mfa.loginGate(user.id);
    if (gate === 'required') {
      return { kind: 'mfa_required', mfa_token: await this.tokens.signMfaChallenge(user.id) };
    }

    await this.audit.log({ actorId: user.id, entityType: 'auth', entityId: user.id, action: 'login' });
    return {
      kind: 'tokens',
      ...(await this.startSession(user.id, req)),
      must_change_password: user.must_change_password,
      mfa_enrollment_required: gate === 'enrollment_required',
    };
  }

  /** Complete an MFA challenge (TOTP or recovery code) → issue the real session. — AUTH MFA */
  async verifyMfa(mfaToken: string, code: string, req?: Request): Promise<LoginOutcome> {
    let userId: string;
    try {
      ({ sub: userId } = await this.tokens.verifyMfaChallenge(mfaToken));
    } catch {
      throw new UnauthorizedException('MFA challenge expired — sign in again');
    }
    await this.mfa.verifyChallenge(userId, code); // throws 401 on a bad/used code
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, must_change_password: true } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.audit.log({ actorId: userId, entityType: 'auth', entityId: userId, action: 'login_mfa' });
    return {
      kind: 'tokens',
      ...(await this.startSession(userId, req)),
      must_change_password: user.must_change_password,
      mfa_enrollment_required: false,
    };
  }

  /** Create a refresh session + access token + CSRF token for a verified user. */
  private async startSession(userId: string, req?: Request): Promise<SessionTokens> {
    const { token: refresh_token, sid } = await this.sessions.issue(userId, req);
    const access_token = await this.tokens.signAccess(userId, sid);
    return { refresh_token, csrf_token: newCsrfToken(), access_token };
  }

  /** Increment the failed-login counter; lock the account once it reaches the configured maximum. */
  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const max = intCfg(this.config, 'LOCKOUT_MAX_ATTEMPTS', 5);
    const minutes = intCfg(this.config, 'LOCKOUT_MINUTES', 15);
    const attempts = current + 1;
    const data: Prisma.UserUpdateInput =
      attempts >= max
        ? { failed_login_attempts: 0, locked_until: new Date(Date.now() + minutes * 60_000) } // reset count for a fresh window after the lock
        : { failed_login_attempts: attempts };
    await this.prisma.user.update({ where: { id: userId }, data });
  }

  /** Rotate the presented (cookie) refresh token → a new access + refresh + CSRF token. */
  async refresh(presentedRefreshToken: string | undefined, req?: Request): Promise<SessionTokens & { must_change_password: boolean }> {
    const rotated = await this.sessions.rotate(presentedRefreshToken, req); // 401 on invalid/expired/reuse
    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
      select: { status: true, must_change_password: true },
    });
    if (!user || user.status !== 'active') {
      await this.sessions.revoke(rotated.sid);
      throw new UnauthorizedException('Invalid refresh token');
    }
    const access_token = await this.tokens.signAccess(rotated.userId, rotated.sid);
    return { refresh_token: rotated.token, csrf_token: newCsrfToken(), access_token, must_change_password: user.must_change_password };
  }

  async logout(user: AuthUser): Promise<void> {
    // Revoke this device's refresh session so the token can't be reused; recorded for the audit trail.
    if (user.sid) {
      await this.sessions.revoke(user.sid, user.id);
    }
    await this.audit.log({
      actorId: user.id,
      entityType: 'auth',
      entityId: user.id,
      action: 'logout',
    });
  }

  /** Current user's profile + effective permissions (union of roles). — AUTH-005 */
  async me(user: AuthUser): Promise<{
    user: unknown;
    roles: string[];
    is_super_admin: boolean;
    rep_id: string | null;
    effective_permissions: string[];
    mfa_enrollment_required: boolean;
  }> {
    const [profile, gate] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: USER_PUBLIC_SELECT }),
      this.mfa.loginGate(user.id), // 'enrollment_required' = policy requires MFA and the user hasn't enrolled
    ]);
    return {
      user: await this.avatars.withDisplayUrl(profile), // a display URL, never a storage path
      roles: user.roleNames,
      is_super_admin: user.isSuperAdmin,
      rep_id: user.repId,
      effective_permissions: [...user.permissions].sort(),
      mfa_enrollment_required: gate === 'enrollment_required',
    };
  }
}
