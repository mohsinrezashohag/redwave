/**
 * Sidebar — design-system §6.6. Navy chrome, grouped module navigation (icon + label), collapsible to
 * icons; the active item uses the accent. Items with a `to` are live routes (rendered as NavLink, active
 * driven by the URL); the rest are PLACEHOLDERS until their screens land. Tokens only.
 */
import {
  BarChart3,
  Bell,
  CheckSquare,
  FileSignature,
  FileText,
  LayoutDashboard,
  Megaphone,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Tags,
  Sparkles,
  Trophy,
  Undo2,
  Upload,
  User,
  UserCircle,
  UserCog,
  Users,
  Users2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, useLocation, type Location } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { Logo } from '../ui/Logo';
import { Tooltip } from '../ui/Tooltip';
import { cx } from '../ui/cx';
import styles from './Sidebar.module.css';

/** What a nav item needs to know about the signed-in user to decide visibility (convenience gate, §5). */
interface NavAccess {
  isSuperAdmin: boolean;
  roles: string[];
  repId: string | null;
  permissions: Set<string>;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Live route target; absent items render as disabled placeholders. */
  to?: string;
  /** Custom active predicate (for query-param presets that share a pathname). */
  match?: (loc: Location) => boolean;
  /** Visibility predicate (convenience only — the server enforces). Absent = always shown. */
  show?: (a: NavAccess) => boolean;
}
interface NavGroup {
  heading: string;
  items: NavItem[];
}

const statusOf = (search: string) => new URLSearchParams(search).get('status');
const canReport = (a: NavAccess) => a.permissions.has('reports:view');
const isAdmin = (a: NavAccess) => a.isSuperAdmin || a.roles.includes('Admin');
// Permissions that reveal at least one Administration hub card (so the nav item isn't a dead-end).
const ADMIN_CARD_PERMS = ['profile:approve', 'users:view', 'roles:view', 'settings:view', 'notifications:broadcast', 'commission:edit', 'clients:view', 'expenses:edit'];
const hasAnyAdmin = (a: NavAccess) => isAdmin(a) || ADMIN_CARD_PERMS.some((p) => a.permissions.has(p));

const NAV: NavGroup[] = [
  {
    heading: 'Dashboards',
    items: [
      { label: 'My Dashboard', icon: UserCircle, to: '/dashboards/rep', show: (a) => !!a.repId },
      {
        label: 'Team',
        icon: Users2,
        to: '/dashboards/manager',
        show: (a) => canReport(a) && (isAdmin(a) || a.roles.includes('Manager')),
      },
      { label: 'Business', icon: LayoutDashboard, to: '/dashboards/business', show: (a) => a.isSuperAdmin },
      { label: 'Operations', icon: CheckSquare, to: '/dashboards/admin', show: isAdmin },
      { label: 'Leaderboard', icon: Trophy, to: '/dashboards/leaderboard', show: canReport },
      // The assistant is authenticated-only (no permission) — shown to every signed-in user; scope is server-side.
      { label: 'Assistant', icon: Sparkles, to: '/chatbot', match: (l) => l.pathname.startsWith('/chatbot'), show: () => true },
    ],
  },
  {
    heading: 'Sales',
    items: [
      // Plain Sales is active anywhere under /sales EXCEPT the Validation preset (?status=entered).
      {
        label: 'Sales',
        icon: ShoppingCart,
        to: '/sales',
        match: (l) => l.pathname.startsWith('/sales') && statusOf(l.search) !== 'entered',
      },
      {
        label: 'Validation',
        icon: CheckSquare,
        to: '/sales?status=entered',
        match: (l) => l.pathname === '/sales' && statusOf(l.search) === 'entered',
      },
    ],
  },
  {
    heading: 'Money',
    items: [
      {
        label: 'Pay Run',
        icon: Wallet,
        to: '/pay-runs',
        match: (l) => l.pathname.startsWith('/pay-runs'),
        show: (a) => a.permissions.has('payrun:view'),
      },
      {
        label: 'Clawbacks',
        icon: Undo2,
        to: '/clawbacks',
        match: (l) => l.pathname.startsWith('/clawbacks'),
        show: (a) => a.permissions.has('clawback:view'),
      },
      {
        label: 'Expenses',
        icon: Receipt,
        to: '/expenses',
        match: (l) => l.pathname.startsWith('/expenses') && l.pathname !== '/expenses/approvals',
        show: (a) => a.permissions.has('expenses:view'),
      },
      {
        label: 'Approvals',
        icon: CheckSquare,
        to: '/expenses/approvals',
        show: (a) => a.permissions.has('expenses:approve'),
      },
      {
        label: 'Billing',
        icon: FileText,
        to: '/billing',
        match: (l) => l.pathname.startsWith('/billing'),
        show: (a) => a.permissions.has('billing:view'),
      },
    ],
  },
  {
    heading: 'People',
    items: [
      { label: 'Reps', icon: Users, to: '/admin/reps', show: (a) => a.permissions.has('hrm:view') },
      {
        label: 'Documents',
        icon: FileSignature,
        to: '/documents',
        match: (l) => l.pathname.startsWith('/documents'),
        show: (a) => a.permissions.has('documents:view'),
      },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Administration', icon: Settings, to: '/admin', match: (l) => l.pathname === '/admin', show: hasAnyAdmin },
      {
        label: 'Profile reviews',
        icon: ShieldCheck,
        to: '/admin/profile-review',
        show: (a) => a.permissions.has('profile:approve'),
      },
      { label: 'Users', icon: Users2, to: '/admin/users', show: (a) => a.permissions.has('users:view') },
      {
        label: 'Roles',
        icon: UserCog,
        to: '/admin/roles',
        match: (l) => l.pathname.startsWith('/admin/roles'),
        show: (a) => a.permissions.has('roles:view'),
      },
      { label: 'Notifications', icon: Bell, to: '/admin/notifications', show: (a) => a.permissions.has('settings:view') },
      { label: 'Broadcast', icon: Megaphone, to: '/admin/broadcast', show: (a) => a.permissions.has('notifications:broadcast') },
      {
        label: 'Clients',
        icon: ShoppingBag,
        to: '/admin/clients',
        match: (l) => l.pathname.startsWith('/admin/clients'),
        show: (a) => a.permissions.has('clients:view'),
      },
      {
        label: 'Products',
        icon: ShoppingCart,
        to: '/admin/products',
        match: (l) => l.pathname.startsWith('/admin/products'),
        show: (a) => a.permissions.has('clients:view'),
      },
      {
        label: 'Commission Config',
        icon: SlidersHorizontal,
        to: '/admin/commission',
        match: (l) => l.pathname.startsWith('/admin/commission'),
        show: (a) => a.permissions.has('commission:view'),
      },
      {
        label: 'Product Types',
        icon: Tags,
        to: '/admin/product-types',
        match: (l) => l.pathname.startsWith('/admin/product-types'),
        show: (a) => a.permissions.has('commission:edit'),
      },
      {
        label: 'Import',
        icon: Upload,
        to: '/import',
        match: (l) => l.pathname.startsWith('/import'),
        show: (a) => a.permissions.has('import:view'),
      },
      { label: 'Reports', icon: BarChart3, to: '/reports', match: (l) => l.pathname.startsWith('/reports'), show: canReport },
    ],
  },
  {
    heading: 'Account',
    items: [{ label: 'My Account', icon: User, to: '/account' }],
  },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const location = useLocation();
  const { isSuperAdmin, roles, repId, permissions } = useAuth();
  const access: NavAccess = { isSuperAdmin, roles, repId, permissions };

  // Drop items whose visibility predicate fails, then drop any group left empty.
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.show || item.show(access)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className={cx(styles.sidebar, collapsed && styles.collapsed)}>
      <div className={styles.brand}>
        {/* Decorative: the sidebar already identifies the app; collapsed shows the icon-only mark.
            Ink = currentColor → inherits the sidebar's --on-brand (light) in both themes. */}
        <Logo variant={collapsed ? 'mark' : 'full'} size="md" decorative />
      </div>
      <nav className={styles.nav}>
        {groups.map((group) => (
          <div className={styles.group} key={group.heading}>
            {!collapsed && <p className={styles.heading}>{group.heading}</p>}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.to ? (item.match ? item.match(location) : location.pathname === item.to) : false;
              const inner = (
                <>
                  <Icon size={20} className={styles.icon} aria-hidden />
                  {!collapsed && <span>{item.label}</span>}
                </>
              );
              const control = item.to ? (
                // Live route — client-side navigation; active driven by the URL.
                <NavLink
                  to={item.to}
                  className={cx(styles.item, active && styles.active)}
                  aria-current={active ? 'page' : undefined}
                >
                  {inner}
                </NavLink>
              ) : (
                // Placeholder — its screen isn't built yet; disabled so it can't dead-end.
                <button type="button" className={cx(styles.item, styles.disabled)} disabled aria-disabled>
                  {inner}
                </button>
              );
              return collapsed ? (
                <Tooltip key={item.label} content={item.label} side="right">
                  {control}
                </Tooltip>
              ) : (
                <div key={item.label}>{control}</div>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
