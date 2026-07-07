/**
 * Expense-document queries + mutations — READ-ONLY over the EXPENSE-BILLING stream (#3): km (client-bill rate)
 * + food (native currency). Every amount is the server's; the UI prices nothing (#1). `preview` returns the
 * grouped draft WITHOUT persisting (no number minted); `generate` ISSUES a new gapless-numbered IMMUTABLE
 * document (a prior version is superseded, never mutated). Downloads/exports stream PDFs via `downloadFile`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { expenseDocKeys } from './keys';
import type { ClientExpenseDocument, ExpenseDocFilters, ExpenseDocPreview, GenerateExpenseDocBody } from '../expenseDocs.types';

export function useExpenseDocs(filters: ExpenseDocFilters = {}, enabled = true) {
  return useQuery({
    queryKey: expenseDocKeys.list(filters),
    queryFn: () => unwrapList<ClientExpenseDocument>(api.GET('/v1/expense-documents', { params: { query: filters } })),
    enabled,
  });
}

export function useExpenseDoc(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: expenseDocKeys.detail(id ?? ''),
    queryFn: () => unwrap<ClientExpenseDocument>(api.GET('/v1/expense-documents/{id}', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
  });
}

export function usePreviewExpenseDoc() {
  return useMutation({
    mutationFn: ({ clientId, body }: { clientId: string; body: GenerateExpenseDocBody }) =>
      unwrap<ExpenseDocPreview>(api.POST('/v1/clients/{id}/expense-documents/preview', { params: { path: { id: clientId } }, body })),
  });
}

export function useGenerateExpenseDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, body }: { clientId: string; body: GenerateExpenseDocBody }) =>
      unwrap<ClientExpenseDocument>(api.POST('/v1/clients/{id}/expense-documents', { params: { path: { id: clientId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseDocKeys.all }),
  });
}
