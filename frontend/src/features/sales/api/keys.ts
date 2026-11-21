/** Query-key factories — the reusable convention (mutations invalidate `salesKeys.all`). */
import type { SalesFilters, SalesListParams } from '../sales.types';

export const salesKeys = {
  all: ['sales'] as const,
  list: (filters: SalesFilters) => ['sales', 'list', filters] as const,
  page: (params: SalesListParams) => ['sales', 'page', params] as const,
  detail: (id: string) => ['sales', 'detail', id] as const,
};

export const clientsKeys = {
  all: ['clients'] as const,
  list: () => ['clients', 'list'] as const,
  products: (clientId: string) => ['clients', clientId, 'products'] as const,
};

/** Sale edit requests (2026-11-16). */
export const saleEditRequestKeys = {
  all: ['sale-edit-requests'] as const,
  page: (params: object) => ['sale-edit-requests', 'page', params] as const,
};
