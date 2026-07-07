/**
 * ExpenseApprovalsPage — the pending-approval queue (SRS EXP-006), item-first. The same item DataTable
 * fixed to status=submitted (manager=roster, admin/SA=all — the server scopes it; the UI never filters),
 * with row selection → bulk approve/reject/send-back and per-row review via the kebab/detail. `expenses:
 * approve` to see; 403 → AccessDenied (server-enforced).
 */
import { PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { ExpenseItemsTable } from '../components/ExpenseItemsTable';
import { ValidationSummaryBanner } from '../components/ValidationSummaryBanner';
import type { ExpenseFilters } from '../expenses.types';
import styles from '../components/expenses.module.css';

const SUBMITTED: ExpenseFilters = { status: 'submitted' };

export default function ExpenseApprovalsPage() {
  const canApprove = useCan('expenses:approve');

  if (!canApprove) {
    return <AccessDenied message="Reviewing expenses requires the expenses approve permission." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Expense approvals"
        subtitle="Items submitted for your review. Approve, reject, or send back — select several to act in bulk."
      />
      <ValidationSummaryBanner filters={SUBMITTED} />
      <ExpenseItemsTable filters={SUBMITTED} canReview />
    </div>
  );
}
