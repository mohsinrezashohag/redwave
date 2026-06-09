/** Query-key factories for the Import feature (mirrors the Documents / Billing playbook). */
import type { ImportFilters } from '../import.types';

export const importKeys = {
  all: ['import'] as const,
  list: (filters: ImportFilters) => ['import', 'list', filters] as const,
  batch: (id: string) => ['import', 'batch', id] as const,
  mappings: () => ['import', 'mappings'] as const,
};
