/**
 * Products queries — the cross-client list (GET /v1/products), server-paginated. The table state (page +
 * sort + the { data, meta } unwrap) is owned by the shared `useServerTable`; this file supplies the products
 * filters + fetch. Product edit/deactivate go through the clients-domain mutations (keyed ['products']).
 */
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { useServerTable } from '../../../lib/query/useServerTable';
import type { Product, ProductPage, ProductSortKey, ProductsFilters, ProductsListParams } from '../products.types';

const LOOKUP_LIMIT = 100;

export const productsListKeys = {
  page: (params: ProductsListParams) => ['products', 'cross-list', params] as const,
};

/** Server-driven list state (page + sort) for the Products table — via the shared `useServerTable`. */
export function useProductsTable(filters: ProductsFilters) {
  return useServerTable<Product, ProductSortKey>({
    queryKey: (p) => productsListKeys.page({ ...filters, ...p }),
    fetchPage: (p) => unwrap<ProductPage>(api.GET('/v1/products', { params: { query: { ...filters, ...p } } })),
    defaultSort: { key: 'created_at', dir: 'asc' },
    filterKey: JSON.stringify(filters),
    limit: 20,
  });
}

/** Fetch ALL products matching the filters (paged) for an export that respects the active filters. */
export async function fetchAllProducts(filters: ProductsFilters): Promise<Product[]> {
  const out: Product[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await unwrap<ProductPage>(api.GET('/v1/products', { params: { query: { ...filters, page, limit: LOOKUP_LIMIT } } }));
    out.push(...res.data);
    if (page >= (res.meta.pageCount || 1)) break;
  }
  return out;
}
