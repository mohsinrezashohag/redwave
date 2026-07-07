/** Query-key factory for the Expense-Documents feature (mirrors the Billing playbook). */
import type { ExpenseDocFilters } from '../expenseDocs.types';

export const expenseDocKeys = {
  all: ['expense-docs'] as const,
  list: (filters: ExpenseDocFilters) => ['expense-docs', 'list', filters] as const,
  detail: (id: string) => ['expense-docs', 'detail', id] as const,
};
