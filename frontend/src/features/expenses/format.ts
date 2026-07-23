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

/**
 * The grouping dimension. Three are date buckets; `category` groups by expense TYPE instead — the question
 * "how much went on meals vs kilometres this month?" the date buckets can't answer.
 */
export type GroupMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'category';

export interface ExpenseGroup {
  key: string;
  label: string;
  count: number;
  /** Exact-decimal REIMBURSABLE total ("X.YY") — sums non-personal item amounts only (EXP-012). */
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
function bucketOf(item: ExpenseItem, mode: GroupMode, configs?: FieldConfig[]): { key: string; label: string } {
  if (mode === 'category') return { key: item.category, label: categoryLabel(item.category, configs) };
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

/**
 * Group items into buckets, each with a count + an exact total. Date buckets sort newest-first; CATEGORY
 * buckets sort by label so the mix reads alphabetically rather than in an arbitrary key order.
 * `configs` is optional and only used to label a category bucket (falls back to a humanized key).
 */
export function groupItems(
  items: ExpenseItem[],
  mode: Exclude<GroupMode, 'none'>,
  configs?: FieldConfig[],
): ExpenseGroup[] {
  const map = new Map<string, ExpenseGroup>();
  for (const item of items) {
    const { key, label } = bucketOf(item, mode, configs);
    const g = map.get(key) ?? { key, label, count: 0, total: '0.00', items: [] };
    g.items.push(item);
    g.count += 1;
    map.set(key, g);
  }
  // The bucket total is REIMBURSABLE — personal (do-not-reimburse) items are captured in the bucket but
  // never counted toward money owed (EXP-012). The count still reflects every item in the bucket.
  const groups = [...map.values()].map((g) => ({
    ...g,
    total: sumMoney(g.items.filter((i) => !i.is_personal).map((i) => i.amount)),
  }));
  return mode === 'category'
    ? groups.sort((a, b) => a.label.localeCompare(b.label))
    : groups.sort((a, b) => (a.key < b.key ? 1 : -1));
}
