/** Query-key factories for the Pay Run feature (mirrors the Expenses/Sales playbook). */
import type { HoldbackFilters } from '../payrun.types';

export const payrunKeys = {
  all: ['payrun'] as const,
  periods: () => ['payrun', 'periods'] as const,
  runs: () => ['payrun', 'runs'] as const,
  run: (id: string) => ['payrun', 'run', id] as const,
  holdback: (filters: HoldbackFilters) => ['payrun', 'holdback', filters] as const,
  holdbackSummary: (runId: string) => ['payrun', 'holdback-summary', runId] as const,
};
