/**
 * Sales queries — the data-fetching pattern (TanStack Query over the openapi-fetch client). ARRAY reads
 * (finders + entry dropdowns) go through `unwrapList`, which normalizes the {data,meta} pagination envelope
 * to a row array, so a consumer's `.map` never crashes (the bug class behind the list-page crash). Results
 * are SERVER-SCOPED (rep=own/manager=roster/admin=all). The paginated DataTable list lives in useSalesList.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrapList } from '../../../lib/query/unwrapList';
import { unwrap } from '../../../lib/query/unwrap';
import { clientsKeys, salesKeys } from './keys';
import type { ClientPage, Product, Rep, Sale, SalePage, SalesFilters } from '../sales.types';

// The list endpoint is paginated (max 100/page); dropdowns/finders that want "all matching" cap here.
const LOOKUP_LIMIT = 100;

/**
 * Filtered sales as a plain array — for the clawback/import finders + any non-paginated consumer. Unwraps
 * the {data,meta} envelope and caps at LOOKUP_LIMIT (these are bounded, server-filtered finder reads).
 */
export function useSalesQuery(filters: SalesFilters) {
  return useQuery({
    queryKey: salesKeys.list(filters),
    queryFn: () => unwrapList<Sale>(api.GET('/v1/sales', { params: { query: { ...filters, limit: LOOKUP_LIMIT } } })),
  });
}

/**
 * Fetch ALL sales matching the filters by paging through the server (for an export that respects the
 * active filters, not just the visible page). Capped at EXPORT_MAX_PAGES × 100 to avoid a runaway.
 */
const EXPORT_MAX_PAGES = 50;
export async function fetchAllSales(filters: SalesFilters): Promise<Sale[]> {
  const out: Sale[] = [];
  for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
    const res = await unwrap<SalePage>(api.GET('/v1/sales', { params: { query: { ...filters, page, limit: LOOKUP_LIMIT } } }));
    out.push(...res.data);
    if (page >= (res.meta.pageCount || 1)) break;
  }
  return out;
}

export function useSaleQuery(id: string | undefined) {
  return useQuery({
    queryKey: salesKeys.detail(id ?? ''),
    queryFn: () => unwrap<Sale>(api.GET('/v1/sales/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useClients(enabled = true) {
  return useQuery({
    queryKey: clientsKeys.list(),
    // /v1/clients is paginated — unwrapList returns the row array for the dropdown (active only, capped).
    queryFn: () =>
      unwrapList<ClientPage['data'][number]>(api.GET('/v1/clients', { params: { query: { limit: LOOKUP_LIMIT } } })),
    enabled,
    staleTime: 5 * 60_000, // clients change rarely
  });
}

export function useClientProducts(clientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: clientsKeys.products(clientId ?? ''),
    queryFn: () =>
      unwrapList<Product>(api.GET('/v1/clients/{id}/products', { params: { path: { id: clientId! } } })),
    enabled: enabled && !!clientId,
    staleTime: 5 * 60_000,
  });
}

/** Reps for the on-behalf selector + rep filter — gated on hrm:view (reps don't have it; admins/SA do). */
export function useReps(enabled = true) {
  return useQuery({
    queryKey: ['reps', 'list'],
    // /v1/reps is the paginated {data,meta} envelope — unwrapList returns the rep array (was the crash site).
    queryFn: () => unwrapList<Rep>(api.GET('/v1/reps')),
    enabled,
    staleTime: 5 * 60_000,
  });
}
