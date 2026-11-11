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
  UnprocessableEntityException,
} from '@nestjs/common';
import { normalizePostal } from '../hrm/rep-profile.logic';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { USER_PUBLIC_SELECT } from '../../common/util/user-public';
import { AvatarService } from '../../common/avatar/avatar.service';
import { FilesService } from '../files/files.service';
import { ChangePasswordDto, ProfileChangeRequestDto, SetThemeDto } from './dto/account.dto';
import { assertPasswordPolicy } from '../auth/password-policy';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';

/** The HR fields a profile-change request may touch on the USER record. */
const PROFILE_FIELDS = ['full_name', 'phone', 'avatar_url'] as const;

/**
 * Rep-only fields a REP may request (client request 2026-11-11), applied to the REP record on approval.
 * Everything else on a rep — code, status, dates, manager, DOB, SIN, equipment, documents — is admin-only and
 * cannot even be requested. full_name + phone also live on the rep and are kept in sync on approval.
 */
const REP_FIELDS = [
  'email',
  'address_street',
  'address_city',
  'address_province',
  'address_postal',
  'jacket_size',
  'tshirt_size',
] as const;

/** Rep PII — written to the audit log as presence only, never the value (docs/security.md §8). */
const REP_PII = new Set<string>(['email', 'address_street', 'address_city', 'address_province', 'address_postal']);

type ProposedChanges = Partial<Record<(typeof PROFILE_FIELDS)[number] | (typeof REP_FIELDS)[number], string>>;

const BCRYPT_ROUNDS = 12;

/** The proposal with rep PII values replaced by `true` — what goes into the audit log. */
function auditSafe(proposed: ProposedChanges): Record<string, unknown> {
  return Object.fromEntries(Object.entries(proposed).map(([k, v]) => [k, REP_PII.has(k) ? true : v]));
}

function pickProposed(input: ProfileChangeRequestDto): ProposedChanges {
  const out: ProposedChanges = {};
  for (const field of [...PROFILE_FIELDS, ...REP_FIELDS]) {
    const value = input[field];
    if (value !== undefined) {
      out[field] = value.trim();
    }
  }
  if (out.email) out.email = out.email.toLowerCase();
  if (out.address_postal) {
    const postal = normalizePostal(out.address_postal);
    if (!postal) {
      throw new UnprocessableEntityException('address_postal must be a Canadian postal code (e.g. R3G 0T7)');
    }
    out.address_postal = postal;
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
    private readonly avatars: AvatarService,
    private readonly files: FilesService,
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
      ...(await this.avatars.withDisplayUrl(profile)),
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
    assertPasswordPolicy(dto.new_password); // enforce the strength policy (→ 422 if weak)
    const password_hash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);
    // Changing the password clears the must-change flag + any residual lockout.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password_hash, must_change_password: false, failed_login_attempts: 0, locked_until: null },
    });
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
      throw new BadRequestException('Provide at least one field to change');
    }
    if (!user.repId && REP_FIELDS.some((f) => proposed[f] !== undefined)) {
      throw new UnprocessableEntityException(
        'Contact email, address and uniform sizes belong to a rep profile — your account is not linked to a rep',
      );
    }
    // The photo is UPLOADED, never a link (2026-11-12): '' removes it, otherwise it must be an avatar file
    // this user uploaded. A rep's photo is their HR headshot, so a rep can't set one here.
    if (proposed.avatar_url !== undefined) {
      if (user.repId) {
        throw new UnprocessableEntityException('Your photo is the headshot HR keeps on file — ask HR to update it');
      }
      if (proposed.avatar_url) await this.files.claim(proposed.avatar_url, user, 'avatar');
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
      after: auditSafe(proposed),
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

  /**
   * Reviewer queue — scoped by routing (Field Manager / Admin / Super Admin). — AUTH-012
   * Each subject carries their CURRENT rep-profile values (`subject.rep`, null for a non-rep) so the reviewer
   * sees current → proposed for address / sizes / contact email, not a misleading "—".
   */
  async listReviewQueue(reviewer: AuthUser) {
    const rows = await this.prisma.profileChangeRequest.findMany({
      where: { status: 'pending', ...this.scope.profileReviewWhere(reviewer) },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        proposed_changes: true,
        created_at: true,
        requested_by: true,
        subject: {
          select: {
            id: true,
            email: true,
            full_name: true,
            phone: true,
            avatar_url: true,
            rep_login: {
              select: {
                email: true,
                address_street: true,
                address_city: true,
                address_province: true,
                address_postal: true,
                jacket_size: true,
                tshirt_size: true,
              },
            },
          },
        },
      },
    });
    // Photos: the subject's current one as a display URL, and the PROPOSED upload as a preview, so the reviewer
    // sees two pictures rather than a storage path. — 2026-11-12
    const urls = await this.avatars.resolve(rows.map((r) => r.subject));
    return Promise.all(
      rows.map(async ({ subject: { rep_login, ...subject }, ...row }) => {
        const proposedPhoto = (row.proposed_changes as ProposedChanges | null)?.avatar_url;
        return {
          ...row,
          proposed_avatar_preview: proposedPhoto ? await this.avatars.previewPath(proposedPhoto) : null,
          subject: { ...subject, avatar_url: urls.get(subject.id) ?? null, rep: rep_login ?? null },
        };
      }),
    );
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

    // Rep fields go to the subject's rep (if any); name + phone are mirrored so the rep record and the login
    // never disagree about who this is or how to reach them.
    const repData: Prisma.RepUpdateInput = {};
    for (const field of REP_FIELDS) {
      if (proposed[field] !== undefined) repData[field] = proposed[field] || null;
    }
    if (proposed.full_name !== undefined) repData.full_name = proposed.full_name;
    if (proposed.phone !== undefined) repData.phone = proposed.phone || null;
    const rep = await this.prisma.rep.findUnique({ where: { user_id: request.user_id }, select: { id: true } });

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: request.user_id }, data });
      }
      if (rep && Object.keys(repData).length > 0) {
        await tx.rep.update({ where: { id: rep.id }, data: repData });
      }
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
      after: auditSafe(proposed),
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
