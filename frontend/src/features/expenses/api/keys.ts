/** Query-key factories for the expenses feature (item-first; mirrors the Sales/admin playbook). */
import type { ExpenseListParams } from '../expenses.types';

export const expenseItemsKeys = {
  all: ['expense-items'] as const,
  page: (params: ExpenseListParams) => ['expense-items', 'list', params] as const,
  detail: (id: string) => ['expense-items', 'detail', id] as const,
};

export const fieldConfigKeys = {
  all: ['expense-field-configs'] as const,
  list: () => ['expense-field-configs', 'list'] as const,
};

export const exportKeys = {
  all: ['expense-exports'] as const,
  list: () => ['expense-exports', 'list'] as const,
};
