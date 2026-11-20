/**
 * Sale edits, edit requests and duplicate approval (client meeting 2026-11-16). Admins/managers edit
 * directly (PATCH); a rep sends an edit REQUEST an approver applies or rejects. Possible duplicates are held
 * until approved. Every mutation invalidates the sales + edit-request queries; the server is the gate.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerTable } from '../../../lib/query/useServerTable';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { saleEditRequestKeys, salesKeys } from './keys';
import type { Sale, SaleEditRequest, SaleEditRequestPage, SaleEditRequestStatus, UpdateSaleBody } from '../sales.types';

function useInvalidateSales() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: salesKeys.all });
    void qc.invalidateQueries({ queryKey: saleEditRequestKeys.all });
  };
}

export function useEditSale() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSaleBody }) =>
      unwrap<Sale>(api.PATCH('/v1/sales/{id}', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

export function useRequestSaleEdit() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSaleBody }) =>
      unwrap<SaleEditRequest>(api.POST('/v1/sales/{id}/edit-requests', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

export function useApproveDuplicate() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<Sale>(api.POST('/v1/sales/{id}/approve-duplicate', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

export type EditRequestSortKey = 'created_at' | 'status';

/** The approvers' paginated queue (server-side list contract, CLAUDE §13.4). */
export function useSaleEditRequestsTable(status: SaleEditRequestStatus | undefined, enabled = true) {
  return useServerTable<SaleEditRequest, EditRequestSortKey>({
    queryKey: (p) => saleEditRequestKeys.page({ ...p, status }),
    fetchPage: (p) =>
      unwrap<SaleEditRequestPage>(api.GET('/v1/sale-edit-requests', { params: { query: { ...p, status } } })),
    defaultSort: { key: 'created_at', dir: 'desc' },
    filterKey: status ?? 'all',
    enabled,
  });
}

export function useDecideEditRequest() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      decision === 'approve'
        ? unwrap<SaleEditRequest>(
            api.POST('/v1/sale-edit-requests/{id}/approve', { params: { path: { id } }, body: { note } }),
          )
        : unwrap<SaleEditRequest>(
            api.POST('/v1/sale-edit-requests/{id}/reject', { params: { path: { id } }, body: { note } }),
          ),
    onSuccess: invalidate,
  });
}
