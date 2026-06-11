/**
 * Profile-change-review hooks — the reviewer's queue + approve/reject. The queue is SCOPED SERVER-SIDE by
 * routing (SA=all, Admin=any rep, field-manager=own reps — SRS AUTH-012); the UI never filters it. Approve
 * applies the change to the live user; reject discards it. Mutations invalidate the queue. Reuses the
 * playbook (TanStack Query + unwrap + invalidate). Responses are `never`-typed → cast to hand types.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { adminKeys } from './keys';
import type { ReviewRequest } from '../admin.types';

export function useReviewQueue(enabled = true) {
  return useQuery({
    queryKey: adminKeys.reviewQueue(),
    queryFn: () => unwrapList<ReviewRequest>(api.GET('/v1/profile-change-requests')),
    enabled,
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<unknown>(api.POST('/v1/profile-change-requests/{id}/approve', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.reviewQueue() }),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<unknown>(api.POST('/v1/profile-change-requests/{id}/reject', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.reviewQueue() }),
  });
}
