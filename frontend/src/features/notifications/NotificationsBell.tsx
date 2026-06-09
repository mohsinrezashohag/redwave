/**
 * NotificationsBell — the TopBar bell. Shows an accurate unread COUNT badge (polled every 60s + on window
 * focus, via useUnreadCount), and a controlled Popover listing the caller's recent notifications. Clicking
 * a row marks it read and deep-links to the related record (closing the popover). A "Mark all read" action
 * and a "View all" link to the Notification Center. Controlled so a click-through can close it.
 */
import { useState } from 'react';
import * as RPopover from '@radix-ui/react-popover';
import { Bell } from 'lucide-react';
import { IconButton } from '../../components/ui';
import { useUnreadCount } from './api/useNotifications';
import { NotificationList } from './NotificationList';
import styles from './NotificationsBell.module.css';
import popoverStyles from '../../components/ui/Popover.module.css';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const count = unread.data?.count ?? 0;

  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <span className={styles.wrap}>
        <RPopover.Trigger asChild>
          <IconButton label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'} icon={<Bell size={18} />} />
        </RPopover.Trigger>
        {count > 0 && (
          <span className={styles.badge} aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <RPopover.Portal>
        <RPopover.Content className={popoverStyles.content} align="end" sideOffset={6}>
          <NotificationList onClose={() => setOpen(false)} />
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
