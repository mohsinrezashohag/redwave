/**
 * useServerTable — the SINGLE source of the server-driven list-table pattern (page + sort state, the
 * `{ data, meta }` envelope unwrap, and the reset-to-page-1-on-change behaviour). Every `use*Table`
 * list hook (sales, clients, products, reps, audit, expense-items, notifications) delegates here, so the
 * envelope's `.data`/`.meta` is read in EXACTLY ONE place — the table half of the fix behind the
 * production `(p.data ?? []).map` crash. The feature supplies its own filter params (via `queryKey` +
 * `fetchPage`); this owns the cross-cutting state. Page is 1-based. — CLAUDE §13 (arch §5.1 list contract)
 */
import { useEffect, useState } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';

/** The pagination meta the backend returns (arch §5.1) — mirrors the contract `PageMetaResponse`. */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

/** The `{ data, meta }` envelope a paginated list endpoint returns. */
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface ServerSort<SortKey extends string> {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/** The resolved page params the helper hands to the feature's `queryKey`/`fetchPage`. */
export interface PageParams {
  page: number;
  limit: number;
  /** `field:dir`, e.g. `sale_date:desc` (arch §5.1). */
  sort: string;
}

export interface UseServerTableOptions<Row, SortKey extends string> {
  /** Build the React Query key for a given page (reuse the feature's key factory, incl. its filters). */
  queryKey: (params: PageParams) => QueryKey;
  /** Fetch one page — the feature does `unwrap<XxxPage>(api.GET(...))` with its filters + these params. */
  fetchPage: (params: PageParams) => Promise<Page<Row>>;
  defaultSort: ServerSort<SortKey>;
  /** A stable signature of the active filters — a change resets to page 1 (a new result set). */
  filterKey: string;
  /** Rows per page (default 20). */
  limit?: number;
  enabled?: boolean;
  /** Direction applied when sorting switches to a NEW column (default `asc`; audit uses `desc`). */
  newColumnDir?: 'asc' | 'desc';
}

export interface ServerTable<Row, SortKey extends string> {
  rows: Row[];
  total: number;
  page: number;
  pageCount: number;
  limit: number;
  setPage: (page: number) => void;
  sort: ServerSort<SortKey>;
  toggleSort: (key: SortKey) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

const DEFAULT_LIMIT = 20;

export function useServerTable<Row, SortKey extends string>(
  opts: UseServerTableOptions<Row, SortKey>,
): ServerTable<Row, SortKey> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const newColumnDir = opts.newColumnDir ?? 'asc';

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ServerSort<SortKey>>(opts.defaultSort);

  const sortKey = `${sort.key}:${sort.dir}`;
  // A new result set (filters or sort changed) returns to the first page.
  useEffect(() => setPage(1), [opts.filterKey, sortKey]);

  const params: PageParams = { page, limit, sort: sortKey };
  const query = useQuery({
    queryKey: opts.queryKey(params),
    queryFn: () => opts.fetchPage(params),
    enabled: opts.enabled ?? true,
  });

  const meta = query.data?.meta;
  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : newColumnDir }));

  return {
    rows: query.data?.data ?? [], // the ONE place the table envelope is unwrapped
    total: meta?.total ?? 0,
    page,
    pageCount: Math.max(1, meta?.pageCount ?? 1),
    limit,
    setPage,
    sort,
    toggleSort,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
