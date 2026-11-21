/** Query-key factories for the Pay Run (commission reports) feature (mirrors the Expenses/Sales playbook). */
import type { PayRunFilters } from '../payrun.types';

export const payrunKeys = {
  all: ['payrun'] as const,
  periods: () => ['payrun', 'periods'] as const,
  runs: () => ['payrun', 'runs'] as const,
  runsPage: (params: PayRunFilters & { page?: number; limit?: number; sort?: string }) =>
    ['payrun', 'runs', 'page', params] as const,
  run: (id: string) => ['payrun', 'run', id] as const,
  runSales: (runId: string, repId: string) => ['payrun', 'run', runId, 'sales', repId] as const,
  lookups: (kind: 'clients' | 'reps') => ['payrun', 'lookups', kind] as const,
};
