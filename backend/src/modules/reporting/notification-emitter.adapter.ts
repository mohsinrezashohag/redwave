/**
 * NotificationEmitterAdapter — binds the app-wide `NOTIFICATION_EMITTER` seam to the real
 * NotificationsService. Any domain module emits an event through the seam; this adapter (provided by the
 * @Global NotificationsModule) turns it into an in-app notification (DOC-006/RPT-009) without that module
 * depending on Reporting feature code.
 */
import { Injectable } from '@nestjs/common';
import {
  NotificationEmitter,
  NotificationEvent,
  NotificationEventBase,
} from '../../common/notifications/notification-emitter';
import { NotificationsService, NotifyPayload } from './notifications.service';

const toPayload = (event: NotificationEventBase): NotifyPayload => ({
  title: event.title,
  body: event.body,
  relatedEntityType: event.relatedEntityType,
  relatedEntityId: event.relatedEntityId,
  variables: event.variables,
});

@Injectable()
export class NotificationEmitterAdapter implements NotificationEmitter {
  constructor(private readonly notifications: NotificationsService) {}

  async emit(event: NotificationEvent): Promise<void> {
    await this.notifications.notify(event.eventType, event.userId, toPayload(event));
  }

  async emitMany(userIds: (string | null | undefined)[], event: NotificationEventBase): Promise<void> {
    await this.notifications.notifyMany(event.eventType, userIds, toPayload(event));
  }

  async emitRole(roleName: string, event: NotificationEventBase): Promise<void> {
    await this.notifications.notifyRole(event.eventType, roleName, toPayload(event));
  }
}
