/**
 * Expense ITEM query hooks (item-first) — the paginated/scoped item list (server-driven page + sort via
 * the use*Table pattern), a single item, a fetch-all for export, the field-config catalogue (dynamic
 * categories + receipt rule), and the exports list. TanStack Query over the typed client via `unwrap<T>()`.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { useServerTable } from '../../../lib/query/useServerTable';
import { expenseItemsKeys, exportKeys, fieldConfigKeys } from './keys';
import type {
  ExpenseExport,
  ExpenseFilters,
  ExpenseItem,
  ExpenseItemPage,
  ExpenseListParams,
  ExpenseSortKey,
  FieldConfig,
} from '../expenses.types';

const LIMIT = 20;
const EXPORT_LIMIT = 100;

/** Server-driven list state (page + sort) for the expense-items DataTable — via the shared `useServerTable`. */
export function useExpenseItemsTable(filters: ExpenseFilters, enabled = true) {
  return useServerTable<ExpenseItem, ExpenseSortKey>({
    queryKey: (p) => expenseItemsKeys.page({ ...filters, ...p } as ExpenseListParams),
    fetchPage: (p) =>
      unwrap<ExpenseItemPage>(api.GET('/v1/expense-items', { params: { query: { ...filters, ...p } } })),
    defaultSort: { key: 'expense_date', dir: 'desc' },
    filterKey: JSON.stringify(filters),
    limit: LIMIT,
    enabled,
  });
}

export function useExpenseItem(id: string | undefined) {
  return useQuery({
    queryKey: expenseItemsKeys.detail(id ?? ''),
    queryFn: () => unwrap<ExpenseItem>(api.GET('/v1/expense-items/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

/** All items matching the filters (across pages) — for the grouped summary. Gated by the caller. */
export function useAllExpenseItems(filters: ExpenseFilters, enabled = true) {
  return useQuery({
    queryKey: [...expenseItemsKeys.all, 'all', filters],
    queryFn: () => fetchAllExpenseItems(filters),
    enabled,
  });
}

/** Fetch ALL items matching the filters (paged) for an export that respects the active filters. */
export async function fetchAllExpenseItems(filters: ExpenseFilters): Promise<ExpenseItem[]> {
  const out: ExpenseItem[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const res = await unwrap<ExpenseItemPage>(
      api.GET('/v1/expense-items', { params: { query: { ...filters, page, limit: EXPORT_LIMIT } } }),
    );
    out.push(...res.data);
    if (page >= (res.meta.pageCount || 1)) break;
  }
  return out;
}

/** The category catalogue — drives the dynamic category selector + the per-category receipt rule. */
export function useFieldConfigs(enabled = true) {
  return useQuery({
    queryKey: fieldConfigKeys.list(),
    queryFn: () => unwrapList<FieldConfig>(api.GET('/v1/expense-field-configs')),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useExpenseExports(enabled = true) {
  return useQuery({
    queryKey: exportKeys.list(),
    queryFn: () => unwrapList<ExpenseExport>(api.GET('/v1/expense-exports')),
    enabled,
  });
}
