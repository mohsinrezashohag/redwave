/** Query-key factory for notifications (mirrors the Sales playbook). */
import type { NotificationFilter, NotificationListParams } from '../notifications.types';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filter: NotificationFilter) => ['notifications', 'list', filter] as const,
  page: (params: NotificationListParams) => ['notifications', 'page', params] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
};

/** Global per-event channel settings (Super Admin). Read-only here; the editor arrives in Session 2. */
export const notificationSettingsKeys = {
  all: ['notification-settings'] as const,
  list: () => ['notification-settings', 'list'] as const,
};
