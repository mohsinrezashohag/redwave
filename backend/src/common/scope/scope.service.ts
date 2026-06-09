/**
 * ScopeService — the data-scope foundation. Access is scoped in the QUERY, never by
 * filtering a response after the fact. — CLAUDE §5, arch §7
 *
 *   getRepScope(user)        → which rep_ids a list endpoint may read (all / roster / self).
 *   profileReviewWhere(user) → Prisma filter for the profile-change review queue (routing).
 *   canReviewRequest(...)    → may THIS reviewer act on THIS request? (re-checked on approve/reject).
 *
 * Profile-change routing (SRS AUTH-012 / §4.4): a rep's request is reviewed by their Field
 * Manager or an Admin; any other user's request is reviewed by a Super Admin.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../rbac/auth-user.type';
import { BUILTIN_ROLES } from '../rbac/rbac.constants';

export type RepScope =
  | { level: 'all' }
  | { level: 'roster'; repIds: string[] }
  | { level: 'self'; repIds: string[] };

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The rep_ids in this user's data scope. Super Admin / Admin → all; a field manager →
   * their roster; a rep → only their own; otherwise an empty self-scope. Consumers apply
   * `where: { rep_id: { in: repIds } }` (omitted when level === 'all').
   */
  async getRepScope(user: AuthUser): Promise<RepScope> {
    if (user.isSuperAdmin || user.roleNames.includes(BUILTIN_ROLES.ADMIN)) {
      return { level: 'all' };
    }
    const managed = await this.prisma.rep.findMany({
      where: { field_manager_id: user.id },
      select: { id: true },
    });
    if (managed.length > 0) {
      return { level: 'roster', repIds: managed.map((r) => r.id) };
    }
    return { level: 'self', repIds: user.repId ? [user.repId] : [] };
  }

  /** Prisma `where` fragment selecting the profile-change requests this reviewer may see. */
  profileReviewWhere(user: AuthUser): Prisma.ProfileChangeRequestWhereInput {
    if (user.isSuperAdmin) {
      return {}; // Super Admin reviews any request.
    }
    if (user.roleNames.includes(BUILTIN_ROLES.ADMIN)) {
      // Admin reviews any rep's request (subject user has a linked rep profile).
      return { subject: { rep_login: { isNot: null } } };
    }
    // Field manager reviews requests from reps they manage.
    return { subject: { rep_login: { is: { field_manager_id: user.id } } } };
  }

  /**
   * The user ids who REVIEW a profile-change request for `subjectUserId` (for notifying the reviewers):
   * a rep's request → their Field Manager + all active Admins + Super Admins; any other subject → Super
   * Admins only. Mirrors `profileReviewWhere`/`canReviewRequest`. — AUTH-012
   */
  async reviewerUserIds(subjectUserId: string): Promise<string[]> {
    const rep = await this.prisma.rep.findUnique({
      where: { user_id: subjectUserId },
      select: { field_manager_id: true },
    });
    const roles = rep ? [BUILTIN_ROLES.ADMIN, BUILTIN_ROLES.SUPER_ADMIN] : [BUILTIN_ROLES.SUPER_ADMIN];
    const users = await this.prisma.user.findMany({
      where: { status: 'active', user_roles: { some: { role: { name: { in: roles } } } } },
      select: { id: true },
    });
    const ids = new Set(users.map((u) => u.id));
    if (rep?.field_manager_id) ids.add(rep.field_manager_id);
    return [...ids];
  }

  /** Whether `reviewer` is allowed to approve/reject a request whose subject is `subjectUserId`. */
  async canReviewRequest(reviewer: AuthUser, subjectUserId: string): Promise<boolean> {
    if (reviewer.isSuperAdmin) {
      return true;
    }
    const rep = await this.prisma.rep.findUnique({
      where: { user_id: subjectUserId },
      select: { field_manager_id: true },
    });
    if (!rep) {
      return false; // Non-rep subject → Super Admin only (handled above).
    }
    if (reviewer.roleNames.includes(BUILTIN_ROLES.ADMIN)) {
      return true;
    }
    return rep.field_manager_id === reviewer.id;
  }
}
