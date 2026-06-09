/**
 * Notification emitter seam — the clean output boundary for "this event should notify a user". ANY domain
 * module injects `NOTIFICATION_EMITTER` and emits through it; the binding is supplied app-wide by the
 * @Global NotificationsModule (which rebinds the default no-op to a real adapter over NotificationsService).
 * Emitting is BEST-EFFORT — it must never break the originating action. Lives in common/ so no module
 * depends on Documents/Reporting to emit, and there is no cycle. — arch §9, RPT-009
 */
import { Injectable } from '@nestjs/common';

export const NOTIFICATION_EMITTER = Symbol('NOTIFICATION_EMITTER');

export interface NotificationEvent {
  eventType: string;
  userId: string;
  /** Fallback title/body used when the event has no SA-edited template. */
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Values substituted into the event's `{var}` template placeholders at send time. */
  variables?: Record<string, string>;
}

export interface NotificationEmitter {
  emit(event: NotificationEvent): Promise<void>;
}

@Injectable()
export class NoopNotificationEmitter implements NotificationEmitter {
  async emit(): Promise<void> {
    // no-op until NotificationsModule rebinds the token
  }
}
