/**
 * Clawback queries — READ-ONLY. The list is rep-scoped server-side; records are flat (no joins). Responses
 * are `never`-typed in the contract → cast to the hand-written types.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { clawbackKeys } from './keys';
import type { Clawback, ClawbackFilters } from '../clawback.types';

export function useClawbacks(filters: ClawbackFilters = {}, enabled = true) {
  return useQuery({
    queryKey: clawbackKeys.list(filters),
    queryFn: () => unwrapList<Clawback>(api.GET('/v1/clawbacks', { params: { query: filters } })),
    enabled,
  });
}

export function useClawback(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: clawbackKeys.detail(id ?? ''),
    queryFn: () => unwrap<Clawback>(api.GET('/v1/clawbacks/{id}', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
  });
}
