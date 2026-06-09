/**
 * ExpenseExportControls — flexible grouping + file export (FE-6). A grouping Select (None/Daily/Weekly/
 * Monthly; the from/to filter supplies a custom range) drives both the on-screen GroupedSummary (in the
 * page) and what the Batch-1 ExportMenu writes: per-ITEM rows when ungrouped, or grouped buckets (period ·
 * count · total) when a mode is chosen. Both PDF + Excel + CSV. Rows respect the active filters (fetched
 * across all pages). Money stays an exact-decimal string (#1). Tokens only.
 */
import { Select } from '../../../components/ui';
import { ExportMenu } from '../../../components/data/ExportMenu';
import { useCan } from '../../../auth/useCan';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { fetchAllExpenseItems } from '../api/useExpenseItems';
import { useClients, useReps } from '../api/useLookups';
import { categoryLabel, groupItems, type ExpenseGroup, type GroupMode } from '../format';
import type { ExpenseFilters, ExpenseItem, FieldConfig } from '../expenses.types';
import styles from './expenses.module.css';

const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'daily', label: 'Group: daily' },
  { value: 'weekly', label: 'Group: weekly' },
  { value: 'monthly', label: 'Group: monthly' },
];

export interface ExpenseExportControlsProps {
  filters: ExpenseFilters;
  groupMode: GroupMode;
  onGroupChange: (mode: GroupMode) => void;
  configs?: FieldConfig[];
}

export function ExpenseExportControls({ filters, groupMode, onGroupChange, configs }: ExpenseExportControlsProps) {
  const canViewReps = useCan('hrm:view');
  const canViewClients = useCan('clients:view');
  const reps = useReps(canViewReps);
  const clients = useClients(canViewClients);

  const repName = (id: string | null) => (id ? reps.data?.find((r) => r.id === id)?.full_name ?? id.slice(0, 8) : '');
  const clientName = (id: string | null) => (id ? clients.data?.find((c) => c.id === id)?.name ?? '' : '');

  const itemColumns: ExportColumn<ExpenseItem>[] = [
    { header: 'Date', value: (it) => displayDate(it.expense_date) },
    { header: 'Category', value: (it) => categoryLabel(it.category, configs) },
    ...(canViewReps ? [{ header: 'Rep', value: (it: ExpenseItem) => repName(it.rep_id) }] : []),
    ...(canViewClients ? [{ header: 'Client', value: (it: ExpenseItem) => clientName(it.client_id) }] : []),
    { header: 'Description', value: (it) => it.description },
    { header: 'Status', value: (it) => it.status },
    { header: 'Amount', value: (it) => money(it.amount) },
  ];

  const groupColumns: ExportColumn<ExpenseGroup>[] = [
    { header: 'Period', value: (g) => g.label },
    { header: 'Items', value: (g) => String(g.count) },
    { header: 'Total', value: (g) => money(g.total) },
  ];

  return (
    <div className={styles.exportControls}>
      <Select aria-label="Grouping" options={GROUP_OPTIONS} value={groupMode} onValueChange={(v) => onGroupChange(v as GroupMode)} />
      {groupMode === 'none' ? (
        <ExportMenu<ExpenseItem>
          filename="expenses"
          title="Expenses"
          columns={itemColumns}
          getRows={() => fetchAllExpenseItems(filters)}
        />
      ) : (
        <ExportMenu<ExpenseGroup>
          filename={`expenses-${groupMode}`}
          title={`Expenses (${groupMode})`}
          columns={groupColumns}
          getRows={async () => groupItems(await fetchAllExpenseItems(filters), groupMode)}
        />
      )}
    </div>
  );
}
