/**
 * Commission Config query hooks — tier schedules, flat rates, holdback split, the (sticky) holdback-release
 * setting, and incentives. Each effective-dated list carries a server-derived `status`. TanStack Query over
 * the typed client via `unwrap<T>()` (the playbook). Responses are `never`-typed → cast to hand types.
 * RATE reads are ONLY /v1/commission/* + /v1/incentives (#3); the client picker (useClients) is a reference.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { commissionKeys } from './keys';
import type { RateStatus } from '../../../components/ui';
import type { FlatRate, HoldbackConfig, HoldbackReleaseSetting, Incentive, IncentiveStatus, TierConfig } from '../commission.types';

/**
 * Tier schedules for a CLIENT SCOPE: a client id for that client's own ladder, the literal `'global'` for
 * the fallback row, or `undefined` for every scope (the default admin view). — CLAUDE #10
 */
export function useTierSchedules(clientId?: string, enabled = true) {
  return useQuery({
    queryKey: commissionKeys.tiers(clientId),
    queryFn: () => unwrap<TierConfig[]>(api.GET('/v1/commission/tiers', { params: { query: { client_id: clientId } } })),
    enabled,
  });
}

export function useFlatRates(status: RateStatus | 'all' = 'all', clientId?: string, enabled = true) {
  return useQuery({
    queryKey: commissionKeys.flatRates(status, clientId),
    queryFn: () =>
      unwrap<FlatRate[]>(api.GET('/v1/commission/flat-rates', { params: { query: { status, client_id: clientId } } })),
    enabled,
  });
}

export function useHoldbackConfig(enabled = true) {
  return useQuery({
    queryKey: commissionKeys.holdback(),
    queryFn: () => unwrap<HoldbackConfig[]>(api.GET('/v1/commission/holdback-config')),
    enabled,
  });
}

export function useReleaseSetting(enabled = true) {
  return useQuery({
    queryKey: commissionKeys.release(),
    queryFn: () => unwrap<HoldbackReleaseSetting | null>(api.GET('/v1/commission/holdback-release-setting')),
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
