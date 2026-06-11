/**
 * ReportsLandingPage — the Reports landing hub (unblocks the previously dead "Reports" nav tab). A
 * hub-of-cards (reusing AdminHubCard) that links to whichever dashboards the caller can see (Business /
 * Operations / Team / My / Leaderboard) plus on-demand report exports (/reports/exports, RPT-015) and
 * cross-period trends (/reports/trends — the Batch-4 charts as a first-class report). Each card is shown
 * by an access predicate over the auth state (convenience; the server enforces each target — a forbidden
 * page renders its own AccessDenied). No dead nav tab for a permitted role.
 */
import { BarChart3, LayoutDashboard, LineChart, Download, Trophy, UserCircle, Users2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { AdminHubCard } from '../../admin/components/AdminHubCard';
import styles from './reports.module.css';

interface ReportAccess {
  isSuperAdmin: boolean;
  roles: string[];
  repId: string | null;
  permissions: Set<string>;
}

interface ReportCard {
  title: string;
  description: string;
  icon: ReactNode;
  to?: string;
  show: (a: ReportAccess) => boolean;
}

const canReport = (a: ReportAccess) => a.permissions.has('reports:view');
const isAdmin = (a: ReportAccess) => a.isSuperAdmin || a.roles.includes('Admin');

const CARDS: ReportCard[] = [
  {
    title: 'Business dashboard',
    description: 'Company-wide revenue, payout, and margin (Super Admin only).',
    icon: <LayoutDashboard size={20} />,
    to: '/dashboards/business',
    show: (a) => a.isSuperAdmin,
  },
  {
    title: 'Operations dashboard',
    description: 'Admin queues and operational health across the platform.',
    icon: <BarChart3 size={20} />,
    to: '/dashboards/admin',
    show: isAdmin,
  },
  {
    title: 'Team dashboard',
    description: 'Roster performance and approvals for your team.',
    icon: <Users2 size={20} />,
    to: '/dashboards/manager',
    show: (a) => canReport(a) && (isAdmin(a) || a.roles.includes('Manager')),
  },
  {
    title: 'My dashboard',
    description: 'Your sales, commission, holdback, and tier progress.',
    icon: <UserCircle size={20} />,
    to: '/dashboards/rep',
    show: (a) => !!a.repId,
  },
  {
    title: 'Leaderboard',
    description: 'Company-wide activation rankings (counts only — never money).',
    icon: <Trophy size={20} />,
    to: '/dashboards/leaderboard',
    show: canReport,
  },
  {
    title: 'Report exports',
    // On-demand only — scheduling is deferred (§12); the copy must not imply it.
    description: 'Generate and download reports.',
    icon: <Download size={20} />,
    to: '/reports/exports',
    // Shown when the caller may export ANY report type (the server enforces each type — RPT-015).
    show: (a) =>
      a.permissions.has('reports:business') ||
      a.permissions.has('reports:view') ||
      a.permissions.has('payrun:export') ||
      a.permissions.has('expenses:export'),
  },
  {
    title: 'Cross-period trends',
    description: 'Revenue, payout, and activation trends over time.',
    icon: <LineChart size={20} />,
    to: '/reports/trends',
    // Same permission as the Business dashboard (the trends endpoint is reports:business).
    show: (a) => a.permissions.has('reports:business'),
  },
];

export default function ReportsLandingPage() {
  const { isSuperAdmin, roles, repId, permissions } = useAuth();
  const access: ReportAccess = { isSuperAdmin, roles, repId, permissions };
  const visible = CARDS.filter((c) => c.show(access));
  // A "coming soon" card always passes show(); gate the page on whether any LINKED report is reachable.
  const hasLinked = visible.some((c) => c.to);

  if (!hasLinked && !canReport(access)) {
    return <AccessDenied message="Viewing reports requires the reports view permission." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Reports" subtitle="Dashboards and reporting. You see only the views your role permits." />
      <div className={styles.grid}>
        {visible.map((c) => (
          <AdminHubCard key={c.title} title={c.title} description={c.description} icon={c.icon} to={c.to} />
        ))}
      </div>
    </div>
  );
}
