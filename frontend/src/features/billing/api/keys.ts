/** Query-key factories for the Billing feature (mirrors the Pay Run / Clawback playbook). */
import type { BillingFilters } from '../billing.types';

export const billingKeys = {
  all: ['billing'] as const,
  statements: (filters: BillingFilters) => ['billing', 'statements', filters] as const,
  statement: (id: string) => ['billing', 'statement', id] as const,
  invoices: (filters: BillingFilters) => ['billing', 'invoices', filters] as const,
  periods: () => ['billing', 'periods'] as const,
};
