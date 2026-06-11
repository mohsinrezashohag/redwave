/**
 * Billing queries — READ-ONLY over the BILLING stream only (#3): statements + invoices. Every amount is the
 * server's (priced from client_billing_rates). Responses are `never`-typed → cast to the hand-written types.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { billingKeys } from './keys';
import type { BillingFilters, ClientInvoice, ClientStatement } from '../billing.types';

export function useStatements(filters: BillingFilters = {}, enabled = true) {
  return useQuery({
    queryKey: billingKeys.statements(filters),
    queryFn: () => unwrapList<ClientStatement>(api.GET('/v1/statements', { params: { query: filters } })),
    enabled,
  });
}

export function useStatement(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: billingKeys.statement(id ?? ''),
    queryFn: () => unwrap<ClientStatement>(api.GET('/v1/statements/{id}', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
  });
}

export function useInvoices(filters: BillingFilters = {}, enabled = true) {
  return useQuery({
    queryKey: billingKeys.invoices(filters),
    queryFn: () => unwrapList<ClientInvoice>(api.GET('/v1/invoices', { params: { query: filters } })),
    enabled,
  });
}

/** The invoice paired with a statement's (client, period) — the one-line commission total. */
export function useInvoiceFor(clientId: string | undefined, payPeriodId: string | undefined, enabled = true) {
  const filters: BillingFilters = { client_id: clientId, pay_period_id: payPeriodId };
  const q = useInvoices(filters, enabled && !!clientId && !!payPeriodId);
  return { ...q, invoice: (q.data ?? [])[0] ?? null };
}
