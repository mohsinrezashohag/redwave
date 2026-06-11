/**
 * Clients query hooks — clients (list/detail), per-client products, and per-client billing rates (each row
 * carries a server-derived `status`). TanStack Query over the typed client; ARRAY reads go through
 * `unwrapList` (normalizes the {data,meta} envelope), the management table through the shared `useServerTable`.
 * ONLY /v1/clients* — no commission path (#3).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { useServerTable } from '../../../lib/query/useServerTable';
import { billingRateKeys, clientsKeys, productKeys } from './keys';
import type {
  BillingRate,
  BillingRateFilters,
  Client,
  ClientPage,
  ClientsFilters,
  ClientsListParams,
  Product,
  StatusFilter,
} from '../clients.types';

const LOOKUP_LIMIT = 100;

/** Clients as a plain array — for dropdowns/pickers (unwraps the page; capped, active by default). */
export function useClients(status: StatusFilter = 'active', enabled = true) {
  return useQuery({
    queryKey: clientsKeys.list(status),
    queryFn: () => unwrapList<Client>(api.GET('/v1/clients', { params: { query: { status, limit: LOOKUP_LIMIT } } })),
    enabled,
  });
}

export type ClientSortKey = 'client_code' | 'name' | 'market' | 'is_active' | 'created_at';

/** Server-driven list state (page + sort) for the Clients management table — via the shared `useServerTable`. */
export function useClientsTable(filters: ClientsFilters) {
  return useServerTable<Client, ClientSortKey>({
    queryKey: (p) => clientsKeys.page({ ...filters, ...p } as ClientsListParams),
    fetchPage: (p) => unwrap<ClientPage>(api.GET('/v1/clients', { params: { query: { ...filters, ...p } } })),
    defaultSort: { key: 'created_at', dir: 'asc' },
    filterKey: JSON.stringify(filters),
    limit: 20,
  });
}

/** Fetch ALL clients matching the filters (paged) for an export that respects the active filters. */
export async function fetchAllClients(filters: ClientsFilters): Promise<Client[]> {
  const out: Client[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await unwrap<ClientPage>(api.GET('/v1/clients', { params: { query: { ...filters, page, limit: LOOKUP_LIMIT } } }));
    out.push(...res.data);
    if (page >= (res.meta.pageCount || 1)) break;
  }
  return out;
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: clientsKeys.detail(id ?? ''),
    queryFn: () => unwrap<Client>(api.GET('/v1/clients/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useClientProducts(clientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: productKeys.list(clientId ?? ''),
    queryFn: () =>
      unwrapList<Product>(api.GET('/v1/clients/{id}/products', { params: { path: { id: clientId! }, query: { status: 'all' } } })),
    enabled: enabled && !!clientId,
  });
}

export function useClientBillingRates(clientId: string | undefined, filters: BillingRateFilters, enabled = true) {
  return useQuery({
    queryKey: billingRateKeys.list(clientId ?? '', filters),
    queryFn: () =>
      unwrapList<BillingRate>(api.GET('/v1/clients/{id}/billing-rates', { params: { path: { id: clientId! }, query: filters } })),
    enabled: enabled && !!clientId,
  });
}
