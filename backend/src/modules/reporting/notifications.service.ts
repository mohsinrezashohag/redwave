/**
 * NotificationsService — generates in-app notifications on events (per the Super-Admin event settings),
 * lists a user's OWN notifications, and manages the event×channel settings. There is NO per-user
 * override: a single global `NotificationEventSetting` per event_type decides in-app/email. Email is
 * dispatched via the stubbed `EMAIL_DISPATCHER`. Notification generation is best-effort — it never
 * throws back to the originating action. — SRS RPT-009/010, arch §6.12
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { EMAIL_DISPATCHER, EmailDispatcher } from './seams/email-dispatcher.provider';
import { renderTemplate } from '../../common/notifications/render-template';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { ListNotificationsQuery } from './dto/list-notifications.query';
import { BroadcastDto } from './dto/broadcast.dto';

export interface NotifyPayload {
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Values substituted into the event's `{var}` template placeholders (else the title/body are used). */
  variables?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(EMAIL_DISPATCHER) private readonly email: EmailDispatcher,
  ) {}

  /** Create a notification for `userId` if the event's in-app channel is on; email if enabled. */
  async notify(eventType: string, userId: string, payload: NotifyPayload): Promise<void> {
    try {
      const setting = await this.prisma.notificationEventSetting.findUnique({
        where: { event_type: eventType },
      });
      const inApp = setting?.in_app_enabled ?? true; // unknown event → safe default: in-app only
      const email = setting?.email_enabled ?? false;

      // The SA-edited templates win (with the call-site `variables` substituted); else the call-site text.
      const title = renderTemplate(setting?.title_template, payload.variables, payload.title);
      const body = renderTemplate(setting?.body_template, payload.variables, payload.body);

      if (inApp) {
        await this.prisma.notification.create({
          data: {
            user_id: userId,
            type: eventType,
            channel: 'in_app',
            title,
            body,
            related_entity_type: payload.relatedEntityType ?? null,
            related_entity_id: payload.relatedEntityId ?? null,
            is_read: false,
          },
        });
      }
      if (email) {
        await this.email.send({ userId, subject: title, body });
      }
    } catch (error) {
      // Best-effort: a notification failure must NEVER break the action that triggered it.
      this.logger.warn(`notify(${eventType}) failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Notify several users (dedupes + drops falsy ids — the central guard for nullable rep user_ids). */
  async notifyMany(eventType: string, userIds: (string | null | undefined)[], payload: NotifyPayload): Promise<void> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    await Promise.all(ids.map((id) => this.notify(eventType, id, payload)));
  }

  /** Notify every ACTIVE user holding `roleName` (e.g. all Admins) — used for role-targeted events + broadcast. */
  async notifyRole(eventType: string, roleName: string, payload: NotifyPayload): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active', user_roles: { some: { role: { name: roleName } } } },
      select: { id: true },
    });
    await this.notifyMany(eventType, users.map((u) => u.id), payload);
  }

  /** The caller's OWN notifications only (never another user's), paginated. — own-scope / arch §5.1 */
  async listOwn(user: AuthUser, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      user_id: user.id,
      ...(query.is_read !== undefined ? { is_read: query.is_read } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { body: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, ['created_at'] as const, { created_at: 'desc' });
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy, skip, take }),
      this.prisma.notification.count({ where }),
    ]);
    return buildPage(data, total, page, limit);
  }

  /** Mark ONE of the caller's own notifications read/unread. */
  async setReadState(id: string, user: AuthUser, isRead: boolean) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, user_id: user.id }, // own-scope guard
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({ where: { id }, data: { is_read: isRead } });
  }

  /** Mark ALL of the caller's unread notifications read. */
  async markAllRead(user: AuthUser): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { user_id: user.id, is_read: false },
      data: { is_read: true },
    });
    return { updated: count };
  }

  /** Bulk mark read/unread (own-scoped — `user_id` in the where means non-owned ids simply don't match). */
  async bulkMark(user: AuthUser, ids: string[], read: boolean): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, user_id: user.id },
      data: { is_read: read },
    });
    return { updated: count };
  }

  /** The caller's unread count (for the polled bell badge). */
  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { user_id: user.id, is_read: false } });
    return { count };
  }

  /** Manual broadcast (notifications:broadcast) — fan out to a role / specific users / everyone active. */
  async broadcast(dto: BroadcastDto, actor: AuthUser): Promise<{ recipients: number }> {
    let userIds: string[] = [];
    if (dto.audience.kind === 'all') {
      const users = await this.prisma.user.findMany({ where: { status: 'active' }, select: { id: true } });
      userIds = users.map((u) => u.id);
    } else if (dto.audience.kind === 'role') {
      const users = await this.prisma.user.findMany({
        where: { status: 'active', user_roles: { some: { role: { name: dto.audience.role } } } },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    } else {
      const users = await this.prisma.user.findMany({
        where: { id: { in: dto.audience.userIds ?? [] }, status: 'active' },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    }
    await this.notifyMany('broadcast', userIds, { title: dto.title, body: dto.body });
    await this.audit.log({
      actorId: actor.id,
      entityType: 'notifications',
      entityId: actor.id,
      action: 'create',
      after: { broadcast: dto.title, audience: dto.audience.kind, recipients: userIds.length },
    });
    return { recipients: userIds.length };
  }

  // ── Settings (Super Admin only — gated in the controller) ────────────────────────────
  listSettings() {
    return this.prisma.notificationEventSetting.findMany({ orderBy: { event_type: 'asc' } });
  }

  async updateSettings(dto: UpdateNotificationSettingsDto, user: AuthUser) {
    const updated = await this.prisma.$transaction(
      dto.settings.map((s) =>
        this.prisma.notificationEventSetting.upsert({
          where: { event_type: s.event_type },
          update: {
            in_app_enabled: s.in_app_enabled,
            email_enabled: s.email_enabled,
            ...(s.label !== undefined ? { label: s.label } : {}),
            ...(s.title_template !== undefined ? { title_template: s.title_template } : {}),
            ...(s.body_template !== undefined ? { body_template: s.body_template } : {}),
            updated_by: user.id,
          },
          create: {
            event_type: s.event_type,
            in_app_enabled: s.in_app_enabled,
            email_enabled: s.email_enabled,
            label: s.label ?? null,
            title_template: s.title_template ?? null,
            body_template: s.body_template ?? null,
            updated_by: user.id,
          },
        }),
      ),
    );
    await this.audit.log({
      actorId: user.id,
      entityType: 'notification_event_settings',
      entityId: user.id,
      action: 'edit',
      after: { events: dto.settings.map((s) => s.event_type) },
    });
    return updated;
  }
}
