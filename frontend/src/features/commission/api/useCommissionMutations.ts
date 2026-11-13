/**
 * Commission Config mutations — add a (future-dated) rep rate (supersedes pending + bounds current
 * server-side; back-date → 422), and create/update incentives. All invalidate the commission cache. The
 * server validates → 422 surfaced by the caller. Responses are typed via the generated schema (Batch A #2).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { commissionKeys } from './keys';
import type {
  CreateFlatRateBody,
  CreateIncentiveBody,
  FlatRate,
  Incentive,
  UpdateFlatRateBody,
  UpdateIncentiveBody,
} from '../commission.types';

export function useCreateFlatRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFlatRateBody) => unwrap<FlatRate>(api.POST('/v1/commission/flat-rates', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useUpdateFlatRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFlatRateBody }) =>
      unwrap<FlatRate>(api.PATCH('/v1/commission/flat-rates/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useDeleteFlatRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/commission/flat-rates/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useCreateIncentive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIncentiveBody) => unwrap<Incentive>(api.POST('/v1/incentives', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useUpdateIncentive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateIncentiveBody }) =>
      unwrap<Incentive>(api.PATCH('/v1/incentives/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

/** Delete an UNUSED incentive (server 422s one already applied to a paid item — end it instead). */
export function useDeleteIncentive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/incentives/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}
