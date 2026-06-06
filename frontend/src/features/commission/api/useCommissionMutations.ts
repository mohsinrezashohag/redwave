/**
 * Commission Config mutations — add a (future-dated) tier schedule / flat rate / holdback split (each
 * supersedes pending + bounds current server-side; back-date → 422), set the sticky holdback-release rule,
 * and create/update incentives. All invalidate the commission cache. The server validates (contiguity / no
 * internet flat / 100% holdback / target_count) → 422 surfaced by the caller. Responses are typed via the
 * generated schema (Batch A #2).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { commissionKeys } from './keys';
import type {
  CreateFlatRateBody,
  CreateIncentiveBody,
  CreateTierScheduleBody,
  FlatRate,
  HoldbackConfig,
  HoldbackReleaseSetting,
  Incentive,
  SetHoldbackConfigBody,
  SetHoldbackReleaseBody,
  TierConfig,
  UpdateIncentiveBody,
} from '../commission.types';

export function useCreateTierSchedule() {
  const qc = useQueryClient();
  return useMutation({
    // The max_count swagger quirk is fixed (Batch A #2), so the generated request type is used directly.
    mutationFn: (body: CreateTierScheduleBody) =>
      unwrap<TierConfig>(api.POST('/v1/commission/tiers', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useCreateFlatRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFlatRateBody) => unwrap<FlatRate>(api.POST('/v1/commission/flat-rates', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useSetHoldback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetHoldbackConfigBody) => unwrap<HoldbackConfig>(api.PATCH('/v1/commission/holdback-config', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useSetRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetHoldbackReleaseBody) =>
      unwrap<HoldbackReleaseSetting>(api.PATCH('/v1/commission/holdback-release-setting', { body })),
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
