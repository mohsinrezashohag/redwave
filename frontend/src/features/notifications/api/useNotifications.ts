/**
 * Notifications hooks — the caller's OWN notifications (paginated), the polled unread count for the bell
 * badge, and the read/unread/mark-all/bulk mutations + broadcast. Own-scoped server-side. Mutations
 * invalidate `notificationKeys.all` so the bell + center + count refresh. (Sales playbook: TanStack Query
 * + unwrap + invalidate.)
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { notificationKeys } from './keys';
import type {
  AppNotification,
  BroadcastBody,
  NotificationListParams,
  NotificationPage,
  NotificationsFilters,
} from '../notifications.types';

const PAGE_SIZE = 20;

/** A page of the caller's own notifications ({ data, meta }). */
export function useNotificationsQuery(params: NotificationListParams, enabled = true) {
  return useQuery({
    queryKey: notificationKeys.page(params),
    queryFn: () => unwrap<NotificationPage>(api.GET('/v1/notifications', { params: { query: params } })),
    enabled,
  });
}

/** Server-driven list state (page + filters) for the Notification Center — mirrors useSalesList. */
export function useNotificationsList(filters: NotificationsFilters) {
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [filterKey]);

  const query = useNotificationsQuery({ ...filters, page, limit: PAGE_SIZE, sort: 'created_at:desc' });
  const meta = query.data?.meta;
  return {
    rows: query.data?.data ?? [],
    total: meta?.total ?? 0,
    page,
    pageCount: Math.max(1, meta?.pageCount ?? 1),
    limit: PAGE_SIZE,
    setPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** The polled unread count for the bell badge — refetches on an interval AND on window focus. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => unwrap<{ count: number }>(api.GET('/v1/notifications/unread-count')),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useSetNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_read }: { id: string; is_read: boolean }) =>
      unwrap<AppNotification>(api.PATCH('/v1/notifications/{id}', { params: { path: { id } }, body: { is_read } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap<{ updated: number }>(api.POST('/v1/notifications/mark-all-read')),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useBulkMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) =>
      unwrap<{ updated: number }>(api.POST('/v1/notifications/mark-read', { body: { ids, read } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BroadcastBody) =>
      unwrap<{ recipients: number }>(api.POST('/v1/notifications/broadcast', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
