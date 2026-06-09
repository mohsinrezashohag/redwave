/**
 * Expense display helpers — category labels (from the dynamic field configs, falling back to a humanized
 * key) and flexible DAILY/WEEKLY/MONTHLY grouping of items for the grouped view + export. Totals are an
 * exact-decimal sum of item amounts for DISPLAY (km amounts are the server-computed values stored on the
 * item), via sumMoney — never float (#1).
 */
import { sumMoney } from '../../lib/format/money';
import type { ExpenseItem, FieldConfig } from './expenses.types';

const humanize = (key: string): string => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function categoryLabel(key: string, configs?: FieldConfig[]): string {
  return configs?.find((c) => c.category_key === key)?.label ?? humanize(key);
}

export type GroupMode = 'none' | 'daily' | 'weekly' | 'monthly';

export interface ExpenseGroup {
  key: string;
  label: string;
  count: number;
  /** Exact-decimal total ("X.YY") of the bucket's item amounts. */
  total: string;
  items: ExpenseItem[];
}

const dateOf = (item: ExpenseItem): string => item.expense_date.slice(0, 10);

/** Monday-anchored ISO week start for a 'YYYY-MM-DD' date (no Date-locale surprises — UTC math). */
function weekStartIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const back = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Bucket key + human label for an item under the chosen mode. */
function bucketOf(item: ExpenseItem, mode: GroupMode): { key: string; label: string } {
  const iso = dateOf(item);
  if (mode === 'daily') return { key: iso, label: iso };
  if (mode === 'weekly') {
    const start = weekStartIso(iso);
    return { key: start, label: `Week of ${start}` };
  }
  // monthly
  const month = iso.slice(0, 7);
  return { key: month, label: month };
}

/** Group items into daily/weekly/monthly buckets (sorted by key desc), each with a count + exact total. */
export function groupItems(items: ExpenseItem[], mode: Exclude<GroupMode, 'none'>): ExpenseGroup[] {
  const map = new Map<string, ExpenseGroup>();
  for (const item of items) {
    const { key, label } = bucketOf(item, mode);
    const g = map.get(key) ?? { key, label, count: 0, total: '0.00', items: [] };
    g.items.push(item);
    g.count += 1;
    map.set(key, g);
  }
  const groups = [...map.values()].map((g) => ({ ...g, total: sumMoney(g.items.map((i) => i.amount)) }));
  return groups.sort((a, b) => (a.key < b.key ? 1 : -1));
}
