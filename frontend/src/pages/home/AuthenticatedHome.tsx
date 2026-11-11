/**
 * AuthenticatedHome — the placeholder authenticated landing (real feature screens come next). Renders
 * inside the app shell, greets the signed-in user, and demonstrates the convenience-only permission
 * gate: each module card is wrapped in <Can> so a user only sees cards their permissions allow — but
 * the SERVER still authorizes every request (CLAUDE §5). For the Super Admin every card shows; a rep
 * would not see, e.g., System Settings.
 */
import { Card, PageHeader, Banner } from '../../components/ui';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import styles from './home.module.css';

const MODULES: { permission: string; title: string; blurb: string }[] = [
  { permission: 'sales:view', title: 'Sales & Validation', blurb: 'Enter and validate activations.' },
  { permission: 'payrun:view', title: 'Pay Run & Holdback', blurb: 'Run bi-weekly payroll.' },
  { permission: 'expenses:view', title: 'Expenses', blurb: 'Submit and approve expenses.' },
  { permission: 'reports:view', title: 'Reports & Dashboards', blurb: 'Role-scoped insights.' },
  { permission: 'settings:edit', title: 'System Settings', blurb: 'Org-wide configuration (admin).' },
];

export default function AuthenticatedHome() {
  const { user, roles, permissions } = useAuth();

  return (
    <div className={styles.stack}>
      <PageHeader
        title={`Welcome, ${user?.full_name ?? 'there'}`}
        subtitle="You're signed in. This is a placeholder home page."
      />

      <Banner tone="success" title="Foundation + authentication are live">
        Login, the session, protected routes, and the server theme-sync all work end to end.
      </Banner>

      <div className={styles.grid}>
        {MODULES.map((m) => (
          <Can key={m.permission} permission={m.permission}>
            <Card title={m.title}>
              <p className={styles.blurb}>{m.blurb}</p>
            </Card>
          </Can>
        ))}
      </div>

      <Card title="Your access">
        <p className={styles.blurb}>
          You hold <strong className="mono">{permissions.size}</strong> effective permission(s)
          {roles.length > 0 ? ` across role(s): ${roles.join(', ')}.` : '.'}
        </p>
        <p className={styles.note}>
          Cards above are gated by <code>useCan</code> for convenience only. The server enforces every
          action server-side (CLAUDE §5). A control you can&rsquo;t see is still rejected server-side if
          called directly.
        </p>
      </Card>
    </div>
  );
}
