/**
 * GroupedSummary — an at-a-glance strip of buckets (label · count · exact total) for the currently-loaded
 * page of items, shown when a grouping is selected: daily / weekly / monthly, or by expense CATEGORY. Totals are sumMoney (exact
 * decimal, #1) — display only. Reuses StatCard for the design-system KPI tile. Tokens only.
 */
import { StatCard } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { groupItems, type GroupMode } from '../format';
import type { ExpenseItem, FieldConfig } from '../expenses.types';
import styles from './expenses.module.css';

export function GroupedSummary({
  items,
  mode,
  configs,
}: {
  items: ExpenseItem[];
  mode: Exclude<GroupMode, 'none'>;
  /** Only used to LABEL a category bucket; a missing config falls back to a humanized key. */
  configs?: FieldConfig[];
}) {
  const groups = groupItems(items, mode, configs);
  if (groups.length === 0) return null;
  return (
    <div className={styles.groupGrid}>
      {groups.map((g) => (
        <StatCard key={g.key} label={g.label} value={money(g.total)} footnote={`${g.count} item(s)`} />
      ))}
    </div>
  );
}
