/**
 * useSalesList — the LIST seam, SERVER-DRIVEN. The backend paginates/sorts/filters/searches and returns
 * { data, meta } (arch §5.1); the cross-cutting page+sort state and the envelope unwrap live in the shared
 * `useServerTable`, this hook supplies the sales filters + fetch. Page is 1-based; changing a filter OR the
 * sort resets to page 1. — CLAUDE §13
 */
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { useServerTable } from '../../../lib/query/useServerTable';
import { salesKeys } from './keys';
import type { Sale, SalePage, SalesFilters, SalesListParams } from '../sales.types';

export type SortKey = 'sale_code' | 'customer_name' | 'sale_date' | 'status';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const PAGE_SIZE = 20;

export function useSalesList(filters: SalesFilters) {
  const table = useServerTable<Sale, SortKey>({
    queryKey: (p) => salesKeys.page({ ...filters, ...p } as SalesListParams),
    fetchPage: (p) => unwrap<SalePage>(api.GET('/v1/sales', { params: { query: { ...filters, ...p } } })),
    defaultSort: { key: 'sale_date', dir: 'desc' },
    filterKey: JSON.stringify(filters),
    limit: PAGE_SIZE,
  });
  return { ...table, pageSize: PAGE_SIZE };
}
