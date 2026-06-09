/**
 * AdminDashboardPage — the operational home (design-system §10.1: "action queues, not charts"). Each
 * queue is a count that jumps to its screen; screens not yet built show the count without a dead link.
 * Admin/Super Admin only (server-enforced). A 403 renders AccessDenied. — SRS §14
 */
import { CheckSquare, FileSignature, Receipt, UserCog, Wallet } from 'lucide-react';
import { PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAdminDashboard } from '../api/useDashboards';
import { AdminQueueCard } from '../components/AdminQueueCard';
import { AccessDenied } from '../components/AccessDenied';
import { isForbidden } from '../../../lib/api/apiError';
import styles from '../dashboards.module.css';

export default function AdminDashboardPage() {
  const q = useAdminDashboard();
  if (isForbidden(q.error)) return <AccessDenied message="The operational home is for Admins and Super Admins." />;

  const d = q.data;
  return (
    <div className={styles.page}>
      <PageHeader title="Operations" subtitle="Open queues across the platform. Jump in where there's work." />
      <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
        {d && (
          <div className={styles.queueGrid}>
            <AdminQueueCard
              label="Pending validations"
              count={d.pending_validations}
              icon={<CheckSquare size={16} />}
              to="/sales?status=entered"
              cta="Review queue"
            />
            <AdminQueueCard label="Expenses to approve" count={d.pending_expense_approvals} icon={<Receipt size={16} />} to="/expenses/approvals" cta="Review queue" />
            <AdminQueueCard label="Profile changes" count={d.pending_profile_changes} icon={<UserCog size={16} />} to="/admin/profile-review" cta="Review queue" />
            <AdminQueueCard label="Signature requests" count={d.pending_signature_requests} icon={<FileSignature size={16} />} to="/documents?queue=awaiting-signatures" cta="Open queue" />
            <AdminQueueCard label="Draft pay runs" count={d.draft_pay_runs} icon={<Wallet size={16} />} to="/pay-runs" cta="Open pay runs" />
          </div>
        )}
      </DataState>
    </div>
  );
}
