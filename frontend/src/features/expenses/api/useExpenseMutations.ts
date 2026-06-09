/**
 * Expense ITEM mutations (item-first) — create one/several items, edit a single item, per-item review
 * (approve/reject/send-back), bulk review, delete, generate an export, and upload a receipt. On success
 * they invalidate the expense-items cache. The km amount is computed SERVER-SIDE — the client never sends
 * `amount` for km items. Toasts via the caller. Responses are typed via the generated schema.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { getAccessToken } from '../../../api/auth-store';
import { unwrap } from '../../../lib/query/unwrap';
import { ApiError } from '../../../lib/api/apiError';
import { expenseItemsKeys, exportKeys } from './keys';
import type {
  BulkReviewBody,
  BulkReviewResult,
  CreateExportBody,
  CreateItemsBody,
  ExpenseExport,
  ExpenseItem,
  ReceiptUpload,
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

/**
 * Upload a receipt via a RAW multipart fetch (openapi-fetch doesn't model multipart well). Returns the
 * URL to store on the item. The server enforces auth + size/type; graceful fallback returns a reference
 * when storage is unconfigured. Bearer token from the in-memory session; base URL matches `api/client`.
 */
export function useUploadReceipt() {
  return useMutation({
    mutationFn: async (file: File): Promise<ReceiptUpload> => {
      const base = import.meta.env.VITE_API_BASE_URL?.trim() || '';
      const form = new FormData();
      form.append('file', file);
      const token = getAccessToken();
      const res = await fetch(`${base}/v1/expense-receipts`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        let details: unknown;
        try {
          const body = (await res.json()) as { error?: { message?: string; details?: unknown } };
          message = body.error?.message ?? message;
          details = body.error?.details;
        } catch {
          /* non-JSON error body */
        }
        throw new ApiError(res.status, message, details);
      }
      return (await res.json()) as ReceiptUpload;
    },
  });
}
