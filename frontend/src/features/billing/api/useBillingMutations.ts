/**
 * Billing mutations — preview + generate. The UI PRICES NOTHING (#1/#3). `previewStatement` returns the
 * one-line-per-customer draft WITHOUT persisting (no number minted); generate ISSUES a new gapless-numbered
 * IMMUTABLE statement/invoice (a prior version is superseded, never mutated). A 422 carries `unpriced[]`
 * (ApiError.details). Downloads/exports stream files via `lib/api/downloadFile` (not here). Responses
 * `never`-typed → cast.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { billingKeys } from './keys';
import type { BulkStatementResult, ClientInvoice, ClientStatement, GenerateBillingBody, StatementPreview } from '../billing.types';

export function usePreviewStatement() {
  return useMutation({
    mutationFn: ({ clientId, body }: { clientId: string; body: GenerateBillingBody }) =>
      unwrap<StatementPreview>(api.POST('/v1/clients/{id}/statements/preview', { params: { path: { id: clientId } }, body })),
  });
}

export function useGenerateStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, body }: { clientId: string; body: GenerateBillingBody }) =>
      unwrap<ClientStatement>(api.POST('/v1/clients/{id}/statements', { params: { path: { id: clientId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
}

export function useGenerateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, body }: { clientId: string; body: GenerateBillingBody }) =>
      unwrap<ClientInvoice>(api.POST('/v1/clients/{id}/invoices', { params: { path: { id: clientId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
}

/**
 * Issue EVERY active client's statement for one billing week. Unlike the per-client generate, a partial
 * result is SUCCESS (200) rather than an error: the response carries generated / skipped / failed, and each
 * failure keeps its `unpriced[]` so the UI can link to the rate that fixes it. Already-issued clients are
 * skipped server-side, so re-running never renumbers.
 */
export function useGenerateAllStatements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId }: { periodId: string }) =>
      unwrap<BulkStatementResult>(
        api.POST('/v1/billing-periods/{id}/statements/generate-all', { params: { path: { id: periodId } } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.all }),
  });
}
