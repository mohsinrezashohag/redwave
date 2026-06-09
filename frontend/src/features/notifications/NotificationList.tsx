/**
 * NotificationList — the caller's recent notifications inside the bell popover. Newest first; unread rows
 * are emphasised. Clicking a row marks it read (PATCH /{id} {is_read}) and deep-links to the related record
 * (resolveNotificationLink), closing the popover. A "Mark all read" action + a "View all" link to the
 * Notification Center. Loading/empty/error via DataState.
 */
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';
import { DataState } from '../../components/data/DataState';
import { relativeTime } from '../../lib/format/date';
import { cx } from '../../components/ui';
import { resolveNotificationLink } from '../../lib/notifications/resolveLink';
import { useMarkAllRead, useNotificationsQuery, useSetNotificationRead } from './api/useNotifications';
import type { AppNotification } from './notifications.types';
import styles from './NotificationList.module.css';

export function NotificationList({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const q = useNotificationsQuery({ page: 1, limit: 8, sort: 'created_at:desc' });
  const setRead = useSetNotificationRead();
  const markAll = useMarkAllRead();
  const rows = q.data?.data ?? [];
  const hasUnread = rows.some((n) => !n.is_read);

  const onActivate = (n: AppNotification) => {
    if (!n.is_read) setRead.mutate({ id: n.id, is_read: true });
    const to = resolveNotificationLink(n);
    onClose();
    if (to) navigate(to);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>Notifications</span>
        {hasUnread && (
          <button type="button" className={styles.headerAction} onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            Mark all read
          </button>
        )}
      </div>
      <div className={styles.scroll}>
        <DataState
          isLoading={q.isLoading}
          isError={q.isError}
          isEmpty={rows.length === 0}
          onRetry={() => q.refetch()}
          loadingNode={<p className={styles.muted}>Loading…</p>}
          emptyNode={<p className={styles.muted}>You're all caught up.</p>}
          errorMessage="Couldn't load notifications."
        >
          <ul className={styles.list}>
            {rows.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cx(styles.item, !n.is_read && styles.unread)}
                  onClick={() => onActivate(n)}
                  aria-label={n.is_read ? n.title : `${n.title} (unread)`}
                >
                  <span className={styles.dot} aria-hidden data-on={!n.is_read} />
                  <span className={styles.body}>
                    <span className={styles.title}>{n.title}</span>
                    <span className={styles.text}>{n.body}</span>
                    <span className={styles.time}>{relativeTime(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DataState>
      </div>
      <div className={styles.footer}>
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => {
            onClose();
            navigate('/notifications');
          }}
        >
          View all notifications
        </Button>
      </div>
    </div>
  );
}
