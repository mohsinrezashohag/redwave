/**
 * NotificationsTab — READ-ONLY view of which notifications the user receives (SRS AUTH-013: NO per-user
 * override — a Super Admin configures channels per event for everyone). The only channel-config endpoint
 * is settings:view-gated, so: a Super Admin sees the real event×channel list; everyone else sees a
 * graceful explanatory banner (a user-facing read endpoint is a flagged backend follow-up). Tokens only.
 */
import { Badge, Banner, Card } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useNotificationSettings } from '../../notifications/api/useNotificationSettings';
import styles from './account.module.css';

const humanize = (eventType: string): string =>
  eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function NotificationsTab() {
  const canView = useCan('settings:view');
  const q = useNotificationSettings(canView);

  if (!canView) {
    return (
      <Banner tone="info" title="Notifications are managed by your administrator">
        You receive in-app (and sometimes email) notifications for account and activity events. The channels
        are configured centrally by a Super Admin. There is no per-user override.
      </Banner>
    );
  }

  return (
    <div className={styles.stack}>
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={(q.data?.length ?? 0) === 0}
        onRetry={() => q.refetch()}
        emptyNode={<Card title="Notification channels"><p className={styles.help}>No events configured.</p></Card>}
      >
        <Card title="Notification channels (read-only)">
          <div className={styles.notifList}>
            {(q.data ?? []).map((s) => (
              <div key={s.id} className={styles.notifRow}>
                <span className={styles.notifEvent}>{humanize(s.event_type)}</span>
                <span className={styles.notifChannels}>
                  <Badge tone={s.in_app_enabled ? 'success' : 'muted'}>
                    In-app {s.in_app_enabled ? 'on' : 'off'}
                  </Badge>
                  <Badge tone={s.email_enabled ? 'success' : 'muted'}>Email {s.email_enabled ? 'on' : 'off'}</Badge>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </DataState>
      <p className={styles.help}>These channels are set by a Super Admin for everyone. There is no per-user override.</p>
    </div>
  );
}
