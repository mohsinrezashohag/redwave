/**
 * AccountService — "My Account" + the profile-change-review flow. — SRS AUTH-009/010/011/012, §4.4
 *
 * Two behaviors are specified precisely:
 *  • Theme toggle is INSTANT — written straight to the user record, no review (AUTH-010).
 *  • HR-field edits (full name / phone / avatar) go through REVIEW — stored as a pending
 *    profile_change_request; the live profile is NEVER written directly. On approval the proposed
 *    values are applied and the request marked approved; on rejection nothing changes (AUTH-011, §4.4).
 *
 * Review routing is enforced by ScopeService (rep → Field Manager/Admin; others → Super Admin).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { USER_PUBLIC_SELECT } from '../../common/util/user-public';
import { ChangePasswordDto, ProfileChangeRequestDto, SetThemeDto } from './dto/account.dto';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';

/** The only HR fields a profile-change request may touch. */
const PROFILE_FIELDS = ['full_name', 'phone', 'avatar_url'] as const;
type ProposedChanges = Partial<Record<(typeof PROFILE_FIELDS)[number], string>>;

const BCRYPT_ROUNDS = 12;

function pickProposed(input: ProfileChangeRequestDto): ProposedChanges {
  const out: ProposedChanges = {};
  for (const field of PROFILE_FIELDS) {
    if (input[field] !== undefined) {
      out[field] = input[field];
    }
  }
  return out;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  /** Own profile + a flag/details if a change is pending review. */
  async getProfile(user: AuthUser) {
    const [profile, pending] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: USER_PUBLIC_SELECT }),
      this.prisma.profileChangeRequest.findFirst({
        where: { user_id: user.id, status: 'pending' },
        orderBy: { created_at: 'desc' },
        select: { id: true, proposed_changes: true, created_at: true },
      }),
    ]);
    return {
      ...profile,
      change_pending: pending !== null,
      pending_request: pending,
    };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<{ success: true }> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { password_hash: true },
    });
    if (!record || !(await bcrypt.compare(dto.current_password, record.password_hash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const password_hash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: user.id }, data: { password_hash } });
    // Never log the password or hash — record only that it changed.
    await this.audit.log({
      actorId: user.id,
      entityType: 'users',
      entityId: user.id,
      action: 'password_change',
    });
    return { success: true };
  }

  /** Theme is a harmless personal setting — applied immediately, no review. — AUTH-010 */
  async setTheme(user: AuthUser, dto: SetThemeDto) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { theme_preference: dto.theme_preference },
      select: { id: true, theme_preference: true },
    });
    return updated;
  }

  /** Create a pending profile-change request. The live profile is NOT modified. — AUTH-011, §4.4 */
  async requestProfileChange(user: AuthUser, dto: ProfileChangeRequestDto) {
    const proposed = pickProposed(dto);
    if (Object.keys(proposed).length === 0) {
      throw new BadRequestException('Provide at least one of: full_name, phone, avatar_url');
    }
    const request = await this.prisma.profileChangeRequest.create({
      data: {
        user_id: user.id,
        requested_by: user.id,
        proposed_changes: proposed as Prisma.InputJsonValue,
        status: 'pending',
      },
      select: { id: true, status: true, proposed_changes: true, created_at: true },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'profile_change_requests',
      entityId: request.id,
      action: 'create',
      after: proposed,
    });
    // Best-effort: notify the reviewer(s) there's a request to review. — profile_change_requested
    const reviewers = await this.scope.reviewerUserIds(user.id);
    await this.emitter.emitMany(reviewers, {
      eventType: 'profile_change_requested',
      title: 'Profile change to review',
      body: `${user.full_name} requested a profile change.`,
      relatedEntityType: 'profile_change_requests',
      relatedEntityId: request.id,
      variables: { subject_name: user.full_name },
    });
    return request;
  }

  listMyRequests(user: AuthUser) {
    return this.prisma.profileChangeRequest.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        status: true,
        proposed_changes: true,
        reviewed_at: true,
        created_at: true,
      },
    });
  }

  /** Reviewer queue — scoped by routing (Field Manager / Admin / Super Admin). — AUTH-012 */
  listReviewQueue(reviewer: AuthUser) {
    return this.prisma.profileChangeRequest.findMany({
      where: { status: 'pending', ...this.scope.profileReviewWhere(reviewer) },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        proposed_changes: true,
        created_at: true,
        requested_by: true,
        subject: {
          select: { id: true, email: true, full_name: true, phone: true, avatar_url: true },
        },
      },
    });
  }

  async approve(reviewer: AuthUser, requestId: string) {
    const request = await this.loadReviewable(reviewer, requestId);
    const proposed = request.proposed_changes as ProposedChanges;
    const data: Prisma.UserUpdateInput = {};
    for (const field of PROFILE_FIELDS) {
      if (proposed[field] !== undefined) {
        data[field] = proposed[field];
      }
    }
    const before = await this.prisma.user.findUnique({
      where: { id: request.user_id },
      select: { full_name: true, phone: true, avatar_url: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: request.user_id }, data });
      await tx.profileChangeRequest.update({
        where: { id: requestId },
        data: { status: 'approved', reviewed_by: reviewer.id, reviewed_at: new Date() },
      });
    });

    await this.audit.log({
      actorId: reviewer.id,
      entityType: 'profile_change_requests',
      entityId: requestId,
      action: 'approve',
      before,
      after: proposed,
    });
    await this.notifyDecided(request.user_id, requestId, 'approved');
    return this.findRequest(requestId);
  }

  async reject(reviewer: AuthUser, requestId: string) {
    const request = await this.loadReviewable(reviewer, requestId);
    await this.prisma.$transaction(async (tx) => {
      await tx.profileChangeRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', reviewed_by: reviewer.id, reviewed_at: new Date() },
      });
    });
    await this.audit.log({
      actorId: reviewer.id,
      entityType: 'profile_change_requests',
      entityId: requestId,
      action: 'reject',
    });
    await this.notifyDecided(request.user_id, requestId, 'rejected');
    return this.findRequest(requestId);
  }

  /** Load a pending request and verify this reviewer is authorized to act on it. — AUTH-012 */
  private async loadReviewable(reviewer: AuthUser, requestId: string) {
    const request = await this.prisma.profileChangeRequest.findUnique({
      where: { id: requestId },
      select: { id: true, user_id: true, status: true, proposed_changes: true },
    });
    if (!request) {
      throw new NotFoundException('Profile change request not found');
    }
    if (request.status !== 'pending') {
      throw new ConflictException('Request has already been reviewed');
    }
    const allowed = await this.scope.canReviewRequest(reviewer, request.user_id);
    if (!allowed) {
      await this.audit.log({
        actorId: reviewer.id,
        entityType: 'profile_change_requests',
        entityId: requestId,
        action: 'access_denied',
        after: { reason: 'not the authorized reviewer for this request' },
      });
      throw new ForbiddenException('You are not the authorized reviewer for this request');
    }
    return request;
  }

  private findRequest(requestId: string) {
    return this.prisma.profileChangeRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        proposed_changes: true,
        reviewed_by: true,
        reviewed_at: true,
        created_at: true,
      },
    });
  }

  /** Best-effort: notify the subject of the decision (post-commit, via the event catalogue). — profile_change_decided */
  private async notifyDecided(userId: string, requestId: string, outcome: 'approved' | 'rejected'): Promise<void> {
    await this.emitter.emit({
      eventType: 'profile_change_decided',
      userId,
      title: `Profile change ${outcome}`,
      body:
        outcome === 'approved'
          ? 'Your requested profile change has been approved and applied.'
          : 'Your requested profile change was rejected; no changes were made.',
      relatedEntityType: 'profile_change_requests',
      relatedEntityId: requestId,
      variables: { outcome },
    });
  }
}
