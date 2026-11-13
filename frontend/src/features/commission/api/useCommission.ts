/**
 * Commission Config query hooks — rep rates (no tiers since 2026-11-13) and incentives. Each
 * effective-dated list carries a server-derived `status`. TanStack Query over the typed client via
 * `unwrap<T>()` (the playbook). Responses are `never`-typed → cast to hand types.
 * RATE reads are ONLY /v1/commission/* + /v1/incentives (#3); the client picker (useClients) is a reference.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { commissionKeys } from './keys';
import type { RateStatus } from '../../../components/ui';
import type { FlatRate, Incentive, IncentiveStatus } from '../commission.types';

export function useFlatRates(status: RateStatus | 'all' = 'all', clientId?: string, enabled = true) {
  return useQuery({
    queryKey: commissionKeys.flatRates(status, clientId),
    queryFn: () =>
      unwrap<FlatRate[]>(api.GET('/v1/commission/flat-rates', { params: { query: { status, client_id: clientId } } })),
    enabled,
  });
}

export function useIncentives(status: IncentiveStatus | 'all' = 'all', enabled = true) {
  return useQuery({
    queryKey: commissionKeys.incentives(status),
    queryFn: () => unwrap<Incentive[]>(api.GET('/v1/incentives', { params: { query: { status } } })),
    enabled,
  });
}

/** Clients for the incentive scope picker — a REFERENCE only (not a rate-stream join, #3). Gated clients:view. */
export interface ClientLite {
  id: string;
  client_code: string;
  name: string;
}
export function useClients(enabled = true) {
  return useQuery({
    queryKey: ['clients', 'list'],
    // /v1/clients is paginated — unwrapList returns the row array for the dropdown (capped).
    queryFn: () => unwrapList<ClientLite>(api.GET('/v1/clients', { params: { query: { limit: 100 } } })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * product id → product name, for labelling per-product rep rates. A REFERENCE read of /v1/products (capped at
 * 100, like the other lookups) — never a rate join (#3).
 */
export function useProductNames(): Map<string, string> {
  const q = useQuery({
    queryKey: ['products', 'names'],
    queryFn: () => unwrapList<{ id: string; name: string }>(api.GET('/v1/products', { params: { query: { limit: 100 } } })),
    staleTime: 5 * 60_000,
  });
  return new Map((q.data ?? []).map((p) => [p.id, p.name]));
}
