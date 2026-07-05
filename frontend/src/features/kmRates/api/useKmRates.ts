/**
 * KM-rate hooks — the per-client, effective-dated kilometre rate. Read is expenses:view; create/delete are
 * expenses:edit (the server is the real gate, §5). Mutations invalidate the list. (Sales playbook: TanStack
 * Query + unwrap + invalidate.)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import type { CreateKmRateBody, KmRate, KmRateStream } from '../kmRates.types';

export interface KmRateFilters {
  stream?: KmRateStream;
  client_id?: string;
  status?: 'current' | 'pending' | 'past' | 'all';
}

export const kmRateKeys = {
  all: ['km-rates'] as const,
  list: (f: KmRateFilters) => ['km-rates', 'list', f] as const,
};

export function useKmRates(filters: KmRateFilters = {}, enabled = true) {
  return useQuery({
    queryKey: kmRateKeys.list(filters),
    queryFn: () =>
      unwrapList<KmRate>(
        api.GET('/v1/km-rates', {
          params: {
            query: {
              ...(filters.stream ? { stream: filters.stream } : {}),
              ...(filters.client_id ? { client_id: filters.client_id } : {}),
              ...(filters.status ? { status: filters.status } : {}),
            },
          },
        }),
      ),
    enabled,
  });
}

export function useCreateKmRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateKmRateBody) => unwrap<KmRate>(api.POST('/v1/km-rates', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: kmRateKeys.all }),
  });
}

export function useDeleteKmRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/v1/km-rates/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: kmRateKeys.all }),
  });
}
