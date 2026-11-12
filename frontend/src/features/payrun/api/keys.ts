/** Query-key factories for the Pay Run feature (mirrors the Expenses/Sales playbook). */

export const payrunKeys = {
  all: ['payrun'] as const,
  periods: () => ['payrun', 'periods'] as const,
  runs: () => ['payrun', 'runs'] as const,
  run: (id: string) => ['payrun', 'run', id] as const,
};
