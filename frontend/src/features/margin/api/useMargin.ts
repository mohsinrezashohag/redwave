/**
 * Margin hooks — per-sale margin, roll-ups, and the rates in force.
 *
 * Super Admin only; the server is the real gate and a 403 renders AccessDenied. Every figure is the
 * server's — the UI computes no money and performs no currency conversion (#1/#12).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrapList } from '../../../lib/query/unwrapList';
import type { MarginGroup, MarginRow, RateInForce, RollupDimension } from '../margin.types';

export const marginKeys = {
  all: ['margin'] as const,
  perSale: (from: string, to: string, clientId?: string) =>
    ['margin', 'per-sale', from, to, clientId ?? 'all'] as const,
  rollup: (from: string, to: string, by: string, clientId?: string) =>
    ['margin', 'rollup', from, to, by, clientId ?? 'all'] as const,
  rates: (on: string, clientId?: string) => ['margin', 'rates', on, clientId ?? 'all'] as const,
};

export function useMarginPerSale(from: string, to: string, clientId?: string, enabled = true) {
  return useQuery({
    queryKey: marginKeys.perSale(from, to, clientId),
    queryFn: () =>
      unwrapList<MarginRow>(
        api.GET('/v1/margin/per-sale', { params: { query: { from, to, client_id: clientId } } }),
      ),
    enabled: enabled && !!from && !!to,
  });
}

export function useMarginRollup(
  from: string,
  to: string,
  by: RollupDimension,
  clientId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: marginKeys.rollup(from, to, by, clientId),
    queryFn: () =>
      unwrapList<MarginGroup>(
        api.GET('/v1/margin/rollup', { params: { query: { from, to, by, client_id: clientId } } }),
      ),
    enabled: enabled && !!from && !!to,
  });
}

export function useRatesInForce(on: string, clientId?: string, enabled = true) {
  return useQuery({
    queryKey: marginKeys.rates(on, clientId),
    queryFn: () =>
      unwrapList<RateInForce>(
        api.GET('/v1/margin/rates-in-force', { params: { query: { on, client_id: clientId } } }),
      ),
    enabled: enabled && !!on,
  });
}
