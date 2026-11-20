/**
 * Pay Run mutations — the orchestrator's write actions. The UI computes NOTHING: DRAFT and FINALIZE are
 * backend calls that return the server-computed run/lines; BONUS posts a decimal string and the server
 * recomputes the net; EXPORT triggers the ADP artifact. All invalidate the payrun cache so reads refresh.
 * Toasts are raised by the caller (success) / useApiErrorToast (error). Responses `never`-typed → cast.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { payrunKeys } from './keys';
import type { CreatePayRunBody, ExportPayRunBody, ExportResult, PayRun, PayRunLine, SetBonusBody } from '../payrun.types';

/**
 * DRAFT / refresh a commission report for a sale-date range (+ optional client / rep / label). The backend
 * computes the preview lines; nothing is frozen. The same range + client + rep refreshes its open draft.
 */
export function useDraftRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePayRunBody) => unwrap<PayRun>(api.POST('/v1/pay-runs', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrunKeys.all }),
  });
}

/** Set an ad-hoc bonus on a DRAFT line (payrun:approve) — the server recomputes net. */
export function useSetBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, lineId, body }: { runId: string; lineId: string; body: SetBonusBody }) =>
      unwrap<PayRunLine>(api.POST('/v1/pay-runs/{id}/lines/{lineId}/bonus', { params: { path: { id: runId, lineId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrunKeys.all }),
  });
}

/** DELETE a DRAFT report (payrun:delete). A paid report is permanent (409 server-side). */
export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      unwrap<{ id: string; deleted: boolean }>(api.DELETE('/v1/pay-runs/{id}', { params: { path: { id: runId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrunKeys.all }),
  });
}

/** FINALIZE ("Mark as paid") — the money-committing action (payrun:approve). Atomic + idempotent server-side (#8). */
export function useFinalizeRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => unwrap<PayRun>(api.POST('/v1/pay-runs/{id}/finalize', { params: { path: { id: runId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrunKeys.all }),
  });
}

/** EXPORT the ADP artifact for a finalized run (payrun:export). Re-export is allowed server-side. */
export function useExportRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, body }: { runId: string; body: ExportPayRunBody }) =>
      unwrap<ExportResult>(api.POST('/v1/pay-runs/{id}/export', { params: { path: { id: runId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrunKeys.all }),
  });
}
