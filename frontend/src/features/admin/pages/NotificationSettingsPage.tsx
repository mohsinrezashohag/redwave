/**
 * NotificationSettingsPage — the Super-Admin per-event channel editor (SRS AUTH-013). Reuses the
 * Session-1 read hook; the editor adds the save. `settings:view` to load; `settings:edit` to change
 * (else the Switches are read-only). A 403 renders AccessDenied. No per-user override (by design).
 */
import { PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useNotificationSettings } from '../../notifications/api/useNotificationSettings';
import { NotificationSettingsEditor } from '../components/NotificationSettingsEditor';
import styles from '../admin.module.css';

export default function NotificationSettingsPage() {
  const canView = useCan('settings:view');
  const canEdit = useCan('settings:edit');
  const q = useNotificationSettings(canView);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Notification settings require the settings view permission." />;
  }

  const settings = q.data ?? [];
  return (
    <div className={styles.page}>
      <PageHeader
        title="Notification settings"
        subtitle="Per event: choose the channels (in-app / email) and edit the title & body templates. Recipients are intrinsic to each trigger and shown read-only. Applies to everyone — no per-user override."
      />
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={settings.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No notification events configured.</p>}
      >
        <NotificationSettingsEditor settings={settings} canEdit={canEdit} />
      </DataState>
    </div>
  );
}
