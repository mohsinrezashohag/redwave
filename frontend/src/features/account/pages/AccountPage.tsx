/**
 * AccountPage — the personal "My Account" area for every authenticated user (SRS AUTH-009). A tabbed
 * layout (design-system §10.6): Profile (edit-as-request), Security (password), Preferences (instant
 * theme), Notifications (read-only). No permission gate — everyone manages their own account.
 */
import { PageHeader, Tabs, type TabItem } from '../../../components/ui';
import { ProfileTab } from '../components/ProfileTab';
import { SecurityTab } from '../components/SecurityTab';
import { PreferencesTab } from '../components/PreferencesTab';
import { NotificationsTab } from '../components/NotificationsTab';
import { SignaturesTab } from '../components/SignaturesTab';

const TABS: TabItem[] = [
  { value: 'profile', label: 'Profile', content: <ProfileTab /> },
  { value: 'security', label: 'Security', content: <SecurityTab /> },
  { value: 'signatures', label: 'Signatures', content: <SignaturesTab /> },
  { value: 'preferences', label: 'Preferences', content: <PreferencesTab /> },
  { value: 'notifications', label: 'Notifications', content: <NotificationsTab /> },
];

export default function AccountPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader title="My Account" subtitle="Manage your profile, security, and preferences." />
      <Tabs items={TABS} defaultValue="profile" ariaLabel="Account sections" />
    </div>
  );
}
