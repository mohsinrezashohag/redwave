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
  UpdateFlatRateBody,
  UpdateHoldbackConfigBody,
  UpdateIncentiveBody,
  UpdateTierScheduleBody,
  CreateTierRateBody,
  UpdateTierRateBody,
  TierRate,
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

/** Edit a PENDING tier schedule (server 422s current/past). */
export function useUpdateTierSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTierScheduleBody }) =>
      unwrap<TierConfig>(api.PATCH('/v1/commission/tiers/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

/** Delete a PENDING tier schedule (server 422s current/past). */
export function useDeleteTierSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/commission/tiers/{id}', { params: { path: { id } } })),
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

export function useCreateTierRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTierRateBody) => unwrap<TierRate>(api.POST('/v1/commission/tier-rates', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useUpdateTierRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTierRateBody }) =>
      unwrap<TierRate>(api.PATCH('/v1/commission/tier-rates/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useDeleteTierRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/commission/tier-rates/{id}', { params: { path: { id } } })),
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

export function useUpdateHoldback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateHoldbackConfigBody }) =>
      unwrap<HoldbackConfig>(api.PATCH('/v1/commission/holdback-config/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useDeleteHoldback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/commission/holdback-config/{id}', { params: { path: { id } } })),
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

/** Delete an UNUSED incentive (server 422s one already applied to a paid item — end it instead). */
export function useDeleteIncentive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/incentives/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}
