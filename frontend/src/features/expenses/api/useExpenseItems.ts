/**
 * Expense ITEM query hooks (item-first) — the paginated/scoped item list (server-driven page + sort via
 * the use*Table pattern), a single item, a fetch-all for export, the field-config catalogue (dynamic
 * categories + receipt rule), and the exports list. TanStack Query over the typed client via `unwrap<T>()`.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
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

export function useExpenseItemsPage(params: ExpenseListParams, enabled = true) {
  return useQuery({
    queryKey: expenseItemsKeys.page(params),
    queryFn: () => unwrap<ExpenseItemPage>(api.GET('/v1/expense-items', { params: { query: params } })),
    enabled,
  });
}

/** Server-driven list state (page + sort) for the expense-items DataTable. Resets to page 1 on a change. */
export function useExpenseItemsTable(filters: ExpenseFilters, enabled = true) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: ExpenseSortKey; dir: 'asc' | 'desc' }>({ key: 'expense_date', dir: 'desc' });
  const filterKey = JSON.stringify(filters);
  const sortKey = `${sort.key}:${sort.dir}`;
  useEffect(() => setPage(1), [filterKey, sortKey]);

  const query = useExpenseItemsPage({ ...filters, page, limit: LIMIT, sort: sortKey }, enabled);
  const meta = query.data?.meta;
  const toggleSort = (key: ExpenseSortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return {
    rows: query.data?.data ?? [],
    total: meta?.total ?? 0,
    page,
    pageCount: Math.max(1, meta?.pageCount ?? 1),
    limit: LIMIT,
    setPage,
    sort,
    toggleSort,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
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
    queryFn: () => unwrap<FieldConfig[]>(api.GET('/v1/expense-field-configs')),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useExpenseExports(enabled = true) {
  return useQuery({
    queryKey: exportKeys.list(),
    queryFn: () => unwrap<ExpenseExport[]>(api.GET('/v1/expense-exports')),
    enabled,
  });
}
