/**
 * NotificationsService — generates in-app notifications on events (per the Super-Admin event settings),
 * lists a user's OWN notifications, and manages the event×channel settings. There is NO per-user
 * override: a single global `NotificationEventSetting` per event_type decides in-app/email. Email is
 * dispatched via the stubbed `EMAIL_DISPATCHER`. Notification generation is best-effort — it never
 * throws back to the originating action. — SRS RPT-009/010, arch §6.12
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { EMAIL_DISPATCHER, EmailDispatcher } from './seams/email-dispatcher.provider';
import { renderTemplate } from '../../common/notifications/render-template';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { ListNotificationsQuery } from './dto/list-notifications.query';

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

  /** The caller's OWN notifications only (never another user's). — own-scope */
  listOwn(user: AuthUser, query: ListNotificationsQuery) {
    return this.prisma.notification.findMany({
      where: {
        user_id: user.id,
        ...(query.is_read !== undefined ? { is_read: query.is_read } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async markRead(id: string, user: AuthUser) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, user_id: user.id }, // scoped — a user can only mark their OWN notification read
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({ where: { id }, data: { is_read: true } });
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
          update: { in_app_enabled: s.in_app_enabled, email_enabled: s.email_enabled, updated_by: user.id },
          create: {
            event_type: s.event_type,
            in_app_enabled: s.in_app_enabled,
            email_enabled: s.email_enabled,
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
