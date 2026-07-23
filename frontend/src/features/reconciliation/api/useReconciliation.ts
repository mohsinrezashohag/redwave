/**
 * Reconciliation queries — the finance tie-out. Statement tie-out is billing:view; pay-run tie-out is
 * payrun:view (server-enforced). Read-only. Responses `never`-typed → cast. — SRS §12
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import type { PayRunTieOut, StatementTieOut } from '../reconciliation.types';

/** Tie a statement out against its lines and a live re-price, for a client + BILLING WEEK. */
export function useStatementTieOut(clientId: string | undefined, billingPeriodId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['reconciliation', 'statement', clientId, billingPeriodId],
    queryFn: () =>
      unwrap<StatementTieOut>(
        api.GET('/v1/reconciliation/statements', {
          params: { query: { client_id: clientId as string, billing_period_id: billingPeriodId as string } },
        }),
      ),
    enabled: enabled && !!clientId && !!billingPeriodId,
  });
}

export function usePayRunTieOut(runId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['reconciliation', 'payrun', runId],
    queryFn: () => unwrap<PayRunTieOut>(api.GET('/v1/reconciliation/pay-runs/{id}', { params: { path: { id: runId as string } } })),
    enabled: enabled && !!runId,
  });
}
