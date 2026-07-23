/**
 * ExpensesListPage — the FOLDER-first expense surface (report-as-folder, EXP-001). A SegmentedControl toggles
 * "Folders" (the primary list of report folders — each with its derived status, reimbursable total, and
 * flagged count) and "All items" (the flat cross-folder item list + grouping/export, kept for admins). "New
 * report" creates a folder. `expenses:view` to see; 403 → AccessDenied. Reuses the playbook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, PageHeader, SegmentedControl } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { todayIso } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { currentPeriod, usePayPeriods } from '../api/useLookups';
import { useAllExpenseItems, useFieldConfigs } from '../api/useExpenseItems';
import { ExpenseFilterBar } from '../components/ExpenseFilterBar';
import { ExpenseItemsTable } from '../components/ExpenseItemsTable';
import { FoldersTable } from '../components/FoldersTable';
import { ValidationSummaryBanner } from '../components/ValidationSummaryBanner';
import { ExpenseExportControls } from '../components/ExpenseExportControls';
import { GroupedSummary } from '../components/GroupedSummary';
import { ExportModal } from '../components/ExportModal';
import { NewReportModal } from '../components/NewReportModal';
import type { GroupMode } from '../format';
import type { ExpenseCategory, ExpenseFilters, ExpenseStatus } from '../expenses.types';
import styles from '../components/expenses.module.css';

const KEYS = ['status', 'category', 'rep_id', 'client_id', 'from', 'to', 'search'] as const;
type View = 'folders' | 'items';

export default function ExpensesListPage() {
  const [params, setParams] = useSearchParams();
  const canView = useCan('expenses:view');
  const canCreate = useCan('expenses:create');
  const canApprove = useCan('expenses:approve');
  const canExport = useCan('expenses:export');
  const canViewPeriods = useCan('payrun:view');
  const [view, setView] = useState<View>('folders');
  const [newReportOpen, setNewReportOpen] = useState(false);
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

  // One-time: default the item view's date range to the current pay cycle (only if the URL has no filters).
  const periods = usePayPeriods(canView && canViewPeriods);
  const configs = useFieldConfigs(canView);
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !periods.data) return;
    const empty = KEYS.every((k) => !params.get(k));
    const cur = currentPeriod(periods.data, todayIso());
    defaulted.current = true;
    if (empty && cur) setParams({ from: cur.start_date.slice(0, 10), to: cur.end_date.slice(0, 10) }, { replace: true });
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

  const grouped = useAllExpenseItems(filters, canView && view === 'items' && groupMode !== 'none');

  if (!canView) return <AccessDenied message="Viewing expenses requires the expenses view permission." />;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Expenses"
        subtitle="Weekly report folders — create a report, add expenses into it, then submit the whole folder for approval."
        actions={
          <div className={styles.headerActions}>
            {view === 'items' && <ExpenseExportControls filters={filters} groupMode={groupMode} onGroupChange={setGroupMode} configs={configs.data} />}
            {view === 'items' && canExport && (
              <Button variant="secondary" onClick={() => setExportOpen(true)}>Record export</Button>
            )}
            {canCreate && (
              <Button variant="primary" onClick={() => setNewReportOpen(true)}>New report</Button>
            )}
          </div>
        }
      />

      <div className={styles.segmentRow}>
        <SegmentedControl<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'folders', label: 'Folders' },
            { value: 'items', label: 'All items' },
          ]}
        />
      </div>

      {view === 'folders' ? (
        <FoldersTable filters={{}} canReview={canApprove} />
      ) : (
        <>
          <ExpenseFilterBar filters={filters} onChange={onChange} />
          {canApprove && <ValidationSummaryBanner filters={filters} />}
          {groupMode !== 'none' && grouped.data && <GroupedSummary items={grouped.data} mode={groupMode} configs={configs.data} />}
          <ExpenseItemsTable filters={filters} canReview={canApprove} />
          <ExportModal open={exportOpen} onOpenChange={setExportOpen} />
        </>
      )}

      <NewReportModal open={newReportOpen} onClose={() => setNewReportOpen(false)} />
    </div>
  );
}
