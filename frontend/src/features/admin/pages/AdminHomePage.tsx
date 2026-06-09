/**
 * AdminHomePage — the role-gated Administration hub (design-system §10.6, SRS AUTH-014): one place that
 * links out to every org-wide config area. Cards are shown per the caller's permissions (convenience; the
 * server enforces each target). Built this session: Profile change reviews. The rest are "coming soon"
 * (user management, roles, notification settings arrive in Session 2; commission/clients/expenses live in
 * their own future screens). A user with no admin permission gets AccessDenied.
 */
import {
  Bell,
  Megaphone,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  UserCog,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { AdminHubCard } from '../components/AdminHubCard';
import styles from '../admin.module.css';

interface HubCard {
  title: string;
  description: string;
  icon: ReactNode;
  /** Permission that reveals the card (convenience gate). */
  permission: string;
  /** Route when built; omit for "coming soon". */
  to?: string;
}

const CARDS: HubCard[] = [
  {
    title: 'Profile change reviews',
    description: 'Approve or reject pending changes to reps’ and users’ profiles.',
    icon: <ShieldCheck size={20} />,
    permission: 'profile:approve',
    to: '/admin/profile-review',
  },
  { title: 'Users', description: 'Create users, assign roles, and deactivate access.', icon: <Users size={20} />, permission: 'users:view', to: '/admin/users' },
  { title: 'Roles & Permissions', description: 'Build roles from a module × action permission matrix.', icon: <UserCog size={20} />, permission: 'roles:view', to: '/admin/roles' },
  { title: 'Notification settings', description: 'Per-event channels and title/body templates.', icon: <Bell size={20} />, permission: 'settings:view', to: '/admin/notifications' },
  { title: 'Send broadcast', description: 'Compose a one-off announcement to everyone, a role, or specific people.', icon: <Megaphone size={20} />, permission: 'notifications:broadcast', to: '/admin/broadcast' },
  { title: 'Commission Config', description: 'Tiers, flat rates, holdback split, and incentives.', icon: <SlidersHorizontal size={20} />, permission: 'commission:edit', to: '/admin/commission' },
  { title: 'Clients', description: 'Partners, their products, and billing rates.', icon: <ShoppingBag size={20} />, permission: 'clients:view', to: '/admin/clients' },
  { title: 'Products', description: 'Every per-client product across all partners.', icon: <ShoppingCart size={20} />, permission: 'clients:view', to: '/admin/products' },
  { title: 'Expense categories', description: 'Category catalogue and receipt requirements.', icon: <Receipt size={20} />, permission: 'expenses:edit' },
];

export default function AdminHomePage() {
  const { permissions } = useAuth();
  const visible = CARDS.filter((c) => permissions.has(c.permission));

  if (visible.length === 0) {
    return <AccessDenied message="You don’t have access to any administration area." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Administration"
        subtitle="Org-wide configuration. You see only the areas your role permits."
      />
      <div className={styles.grid}>
        {visible.map((c) => (
          <AdminHubCard key={c.title} title={c.title} description={c.description} icon={c.icon} to={c.to} />
        ))}
      </div>
    </div>
  );
}
