/**
 * UsersService — admin user management: create users (hashed password), edit/deactivate,
 * and assign roles. This is the ADMIN flow (gated by users:* permissions) and writes directly;
 * it is distinct from the self-service profile-change-review flow in the Account module. — AUTH-005/008
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { USER_PUBLIC_SELECT } from '../../common/util/user-public';
import { MailerService } from '../../common/email/mailer.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { RefreshSessionService } from '../auth/refresh-session.service';
import { MfaService } from '../auth/mfa.service';
import { AvatarService } from '../../common/avatar/avatar.service';
import { assertPasswordPolicy } from '../auth/password-policy';
import { AdminResetPasswordDto, CreateUserDto, SetUserRolesDto, UpdateUserDto } from './dto/user.dto';

const USER_WITH_ROLES_SELECT = {
  ...USER_PUBLIC_SELECT,
  user_roles: { select: { role: { select: { id: true, name: true } } } },
} as const;

const BCRYPT_ROUNDS = 12;

/** A strong random password that satisfies the policy (upper + lower + digit), for invite/temp use. */
function randomPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digit)];
  for (let i = 0; i < 9; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly passwordReset: PasswordResetService,
    private readonly sessions: RefreshSessionService,
    private readonly mfa: MfaService,
    private readonly avatars: AvatarService,
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: USER_WITH_ROLES_SELECT,
      orderBy: { created_at: 'asc' },
    });
    return this.avatars.withDisplayUrls(users); // photo = signed display URL (a rep's = their headshot)
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_WITH_ROLES_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return (await this.avatars.withDisplayUrl(user))!;
  }

  async create(dto: CreateUserDto, actorId: string) {
    // INVITE when no password is given: create with a random hash + must_change, then email a set-password
    // link. Otherwise set the provided (policy-checked) password. — AUTH-002
    const invite = !dto.password;
    if (dto.password) {
      assertPasswordPolicy(dto.password);
    }
    const password_hash = await bcrypt.hash(dto.password ?? randomPassword(), BCRYPT_ROUNDS);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password_hash,
          full_name: dto.full_name,
          phone: dto.phone,
          theme_preference: 'system',
          status: 'active',
          must_change_password: invite,
        },
      });
      if (dto.role_ids?.length) {
        await tx.userRole.createMany({
          data: dto.role_ids.map((role_id) => ({ user_id: user.id, role_id })),
          skipDuplicates: true,
        });
      }
      return user;
    });
    await this.audit.log({
      actorId,
      entityType: 'users',
      entityId: created.id,
      action: 'create',
      // never log the password / hash
      after: { email: created.email, full_name: created.full_name, role_ids: dto.role_ids ?? [], invited: invite },
    });
    if (invite) {
      const token = await this.passwordReset.issueToken(created.id, 'invite');
      await this.mailer.sendInvite(created.email, created.full_name, token);
    }
    return this.findOne(created.id);
  }

  /**
   * Admin-assisted reset — the admin NEVER sees the password. Either email a reset link, or email a
   * forced-change temporary password. — AUTH-002 (security)
   */
  async resetPassword(id: string, dto: AdminResetPasswordDto, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, full_name: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (dto.mode === 'temp') {
      const temp = randomPassword();
      const password_hash = await bcrypt.hash(temp, BCRYPT_ROUNDS);
      await this.prisma.user.update({
        where: { id },
        data: { password_hash, must_change_password: true, failed_login_attempts: 0, locked_until: null },
      });
      await this.mailer.sendTempPassword(user.email, user.full_name, temp); // emailed to the USER only
    } else {
      const token = await this.passwordReset.issueToken(id, 'reset');
      await this.mailer.sendPasswordReset(user.email, user.full_name, token);
    }
    await this.audit.log({ actorId, entityType: 'users', entityId: id, action: `password_reset_${dto.mode}` });
    return { success: true };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      select: { full_name: true, phone: true, avatar_url: true, status: true },
    });
    if (!before) {
      throw new NotFoundException('User not found');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        full_name: dto.full_name,
        phone: dto.phone,
        status: dto.status,
      },
      select: { full_name: true, phone: true, avatar_url: true, status: true },
    });
    const deactivated = dto.status === 'inactive' && before.status !== 'inactive';
    await this.audit.log({
      actorId,
      entityType: 'users',
      entityId: id,
      action: deactivated ? 'deactivate' : 'update',
      before,
      after: updated,
    });
    // Deactivation = immediate force-logout: revoke every live refresh session so no token can refresh. — AUTH-008
    if (deactivated) {
      await this.sessions.revokeAllForUser(id);
    }
    return this.findOne(id);
  }

  /** SA force-logout: revoke ALL of a user's sessions (every device). — arch §security */
  async forceLogout(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const revoked = await this.sessions.revokeAllForUser(id);
    await this.audit.log({ actorId, entityType: 'users', entityId: id, action: 'force_logout', after: { revoked } });
    return { success: true };
  }

  /** SA disables a user's MFA (e.g. lost authenticator) — they re-enrol next login if policy requires it. */
  async disableMfa(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.mfa.adminDisable(id, actorId);
    return { success: true };
  }

  async setRoles(id: string, dto: SetUserRolesDto, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, user_roles: { select: { role_id: true } } },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const before = user.user_roles.map((ur) => ur.role_id);
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { user_id: id } }),
      this.prisma.userRole.createMany({
        data: dto.role_ids.map((role_id) => ({ user_id: id, role_id })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.log({
      actorId,
      entityType: 'users',
      entityId: id,
      action: 'update',
      before: { role_ids: before },
      after: { role_ids: dto.role_ids },
    });
    return this.findOne(id);
  }
}
