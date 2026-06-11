/**
 * Notification SETTINGS read hook — the global per-event channel config (GET /v1/notification-settings,
 * gated settings:view / Super Admin). Read-only here: the My Account Notifications tab shows it, and
 * Session 2's editor will reuse this hook + add the PATCH. Callers gate `enabled` on the permission so a
 * non-SA never fires the (would-be 403) request.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrapList } from '../../../lib/query/unwrapList';
import { notificationSettingsKeys } from './keys';
import type { NotificationSetting } from '../notifications.types';

export function useNotificationSettings(enabled = true) {
  return useQuery({
    queryKey: notificationSettingsKeys.list(),
    queryFn: () => unwrapList<NotificationSetting>(api.GET('/v1/notification-settings')),
    enabled,
    staleTime: 5 * 60_000, // changes rarely
  });
}
