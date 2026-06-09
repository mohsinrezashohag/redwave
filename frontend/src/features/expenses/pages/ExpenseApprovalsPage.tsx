/**
 * ExpenseApprovalsPage — the pending-approval queue (SRS EXP-006). A server-scoped list (`status=submitted`;
 * manager=roster, admin/SA=all — the UI never filters) → a card per report with Approve / Reject / Send-back,
 * PLUS bulk-select → bulk Approve (fans out the approve mutation; the server is the real gate). `expenses:
 * approve` to see; 403 → AccessDenied.
 */
import { useState } from 'react';
import { BulkActionBar, Button, Checkbox, PageHeader, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useExpenseReports, useFieldConfigs } from '../api/useExpenses';
import { useReviewReport } from '../api/useExpenseMutations';
import { ExpenseReviewCard } from '../components/ExpenseReviewCard';
import styles from '../components/expenses.module.css';

export default function ExpenseApprovalsPage() {
  const canApprove = useCan('expenses:approve');
  const { toast } = useToast();
  const q = useExpenseReports({ status: 'submitted' }, canApprove);
  const configs = useFieldConfigs(canApprove);
  const review = useReviewReport();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulking, setBulking] = useState(false);

  if (!canApprove || isForbidden(q.error)) {
    return <AccessDenied message="Reviewing expenses requires the expenses approve permission." />;
  }

  const reports = q.data ?? [];
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });

  const bulkApprove = async () => {
    const ids = [...selected];
    setBulking(true);
    const results = await Promise.allSettled(ids.map((id) => review.mutateAsync({ id, body: { decision: 'approve' } })));
    setBulking(false);
    const done = results.filter((r) => r.status === 'fulfilled').length;
    toast({ title: `Approved ${done} of ${ids.length} report(s)`, tone: done === ids.length ? 'success' : 'warning' });
    setSelected(new Set());
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Expense approvals" subtitle="Reports submitted for your review. Approve, reject, or send back — or bulk-approve several at once." />
      {selected.size > 0 && (
        <BulkActionBar count={selected.size}>
          <Button variant="primary" size="sm" onClick={bulkApprove} loading={bulking}>
            Approve selected
          </Button>
          <Button variant="tertiary" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </BulkActionBar>
      )}
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={reports.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No expenses awaiting approval.</p>}
      >
        <div className={styles.queue}>
          {reports.map((r) => (
            <div key={r.id} className={styles.selectableRow}>
              <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} aria-label={`Select report ${r.id}`} />
              <div className={styles.selectableBody}>
                <ExpenseReviewCard report={r} configs={configs.data ?? []} />
              </div>
            </div>
          ))}
        </div>
      </DataState>
    </div>
  );
}
