/**
 * Expense ITEM mutations (item-first) — create one/several items, edit a single item, per-item review
 * (approve/reject/send-back), bulk review, delete, and generate an export. On success
 * they invalidate the expense-items cache. The km amount is computed SERVER-SIDE — the client never sends
 * `amount` for km items. Toasts via the caller. Responses are typed via the generated schema.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { expenseItemsKeys, exportKeys } from './keys';
import type {
  BulkReviewBody,
  BulkReviewResult,
  CreateExportBody,
  CreateItemsBody,
  ExpenseExport,
  ExpenseItem,
  ReviewBody,
  UpdateItemBody,
} from '../expenses.types';

export function useCreateItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateItemsBody) => unwrap<ExpenseItem[]>(api.POST('/v1/expense-items', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseItemsKeys.all }),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateItemBody }) =>
      unwrap<ExpenseItem>(api.PATCH('/v1/expense-items/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseItemsKeys.all }),
  });
}

export function useReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewBody }) =>
      unwrap<ExpenseItem>(api.POST('/v1/expense-items/{id}/review', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseItemsKeys.all }),
  });
}

export function useBulkReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkReviewBody) =>
      unwrap<BulkReviewResult>(api.POST('/v1/expense-items/bulk-review', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseItemsKeys.all }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<{ id: string; deleted: boolean }>(api.DELETE('/v1/expense-items/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseItemsKeys.all }),
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExportBody) => unwrap<ExpenseExport>(api.POST('/v1/expense-exports', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: exportKeys.all }),
  });
}

// NOTE: receipt uploads moved to the unified pipeline — `lib/files/uploadStoredFile` (POST /v1/files,
// purpose=receipt, XHR progress) called by ReceiptField; the item stores the SERVER-GENERATED PATH and
// viewing goes through GET /v1/expense-items/{id}/receipt-url (60s signed URL).
