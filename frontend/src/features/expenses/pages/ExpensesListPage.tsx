/**
 * ExpensesListPage — the item-first expense list (SRS EXP-010). Server-scoped + paginated items on a
 * DataTable, with filters in the URL (status/category/rep/client/date/search), defaulting the date range to
 * the CURRENT pay cycle for users who can read pay periods (payrun:view). Approvers get bulk approve/reject/
 * send-back; everyone with create can add items. Flexible daily/weekly/monthly grouping + PDF/Excel export,
 * plus a server-recorded export (for the per-rep KM-log client submission). `expenses:view` to see; 403 →
 * AccessDenied. Reuses the playbook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { todayIso } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { currentPeriod, usePayPeriods } from '../api/useLookups';
import { useAllExpenseItems, useFieldConfigs } from '../api/useExpenseItems';
import { ExpenseFilterBar } from '../components/ExpenseFilterBar';
import { ExpenseItemsTable } from '../components/ExpenseItemsTable';
import { ExpenseExportControls } from '../components/ExpenseExportControls';
import { GroupedSummary } from '../components/GroupedSummary';
import { ExportModal } from '../components/ExportModal';
import type { GroupMode } from '../format';
import type { ExpenseCategory, ExpenseFilters, ExpenseStatus } from '../expenses.types';
import styles from '../components/expenses.module.css';

const KEYS = ['status', 'category', 'rep_id', 'client_id', 'from', 'to', 'search'] as const;

export default function ExpensesListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canView = useCan('expenses:view');
  const canCreate = useCan('expenses:create');
  const canApprove = useCan('expenses:approve');
  const canExport = useCan('expenses:export');
  const canViewPeriods = useCan('payrun:view');
  const [exportOpen, setExportOpen] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>('none');

  const filters = useMemo<ExpenseFilters>(
    () => ({
      status: (params.get('status') as ExpenseStatus | null) ?? undefined,
      category: (params.get('category') as ExpenseCategory | null) ?? undefined,
      rep_id: params.get('rep_id') ?? undefined,
      client_id: params.get('client_id') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      search: params.get('search') ?? undefined,
    }),
    [params],
  );

  // One-time: default the date range to the current pay cycle (only if the URL has no filters at all).
  const periods = usePayPeriods(canView && canViewPeriods);
  const configs = useFieldConfigs(canView);
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !periods.data) return;
    const empty = KEYS.every((k) => !params.get(k));
    const cur = currentPeriod(periods.data, todayIso());
    if (empty && cur) {
      defaulted.current = true;
      setParams({ from: cur.start_date.slice(0, 10), to: cur.end_date.slice(0, 10) }, { replace: true });
    } else {
      defaulted.current = true;
    }
  }, [periods.data, params, setParams]);

  const onChange = useCallback(
    (patch: Partial<ExpenseFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const k of KEYS) {
            if (k in patch) {
              const v = patch[k];
              if (v) next.set(k, v);
              else next.delete(k);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const grouped = useAllExpenseItems(filters, canView && groupMode !== 'none');

  if (!canView) {
    return <AccessDenied message="Viewing expenses requires the expenses view permission." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Expenses"
        subtitle="Every expense item across your scope. Filter, group, approve, and export."
        actions={
          <div className={styles.headerActions}>
            <ExpenseExportControls filters={filters} groupMode={groupMode} onGroupChange={setGroupMode} configs={configs.data} />
            {canExport && (
              <Button variant="secondary" onClick={() => setExportOpen(true)}>
                Record export
              </Button>
            )}
            {canCreate && (
              <Button variant="primary" onClick={() => navigate('/expenses/new')}>
                Add expense
              </Button>
            )}
          </div>
        }
      />
      <ExpenseFilterBar filters={filters} onChange={onChange} />
      {groupMode !== 'none' && grouped.data && <GroupedSummary items={grouped.data} mode={groupMode} />}
      <ExpenseItemsTable filters={filters} canReview={canApprove} />
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
