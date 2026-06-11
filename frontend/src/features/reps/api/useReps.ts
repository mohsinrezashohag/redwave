/**
 * Reps queries — the HRM rep roster (GET /v1/reps), server-paginated. Mirrors useProductsTable: the hook
 * owns page + sort state and sends them as query params; the table consumes { data, meta }. Read-only list
 * (this batch builds the roster view; rep CRUD is its own future screen). `hrm:view` server-enforced.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { useServerTable } from '../../../lib/query/useServerTable';
import type { Rep, RepPage, RepSortKey, RepsFilters, RepsListParams } from '../reps.types';

const LIMIT = 20;
const LOOKUP_LIMIT = 100;

export const repsListKeys = {
  all: ['reps'] as const,
  page: (params: RepsListParams) => ['reps', 'list', params] as const,
};

/** Assign / reassign reps to a field manager (bulk). — hrm:edit (server-enforced) */
export function useBulkAssignManager() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { rep_ids: string[]; field_manager_id: string }) =>
      unwrap<{ success: true; count: number }>(api.POST('/v1/reps/bulk-assign-manager', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repsListKeys.all }),
  });
}

/** Server-driven list state (page + sort) for the Reps table — via the shared `useServerTable`. */
export function useRepsTable(filters: RepsFilters, enabled = true) {
  return useServerTable<Rep, RepSortKey>({
    queryKey: (p) => repsListKeys.page({ ...filters, ...p } as RepsListParams),
    fetchPage: (p) => unwrap<RepPage>(api.GET('/v1/reps', { params: { query: { ...filters, ...p } } })),
    defaultSort: { key: 'rep_code', dir: 'asc' },
    filterKey: JSON.stringify(filters),
    limit: LIMIT,
    enabled,
  });
}

/** Fetch ALL reps matching the filters (paged) for an export that respects the active filters. */
export async function fetchAllReps(filters: RepsFilters): Promise<Rep[]> {
  const out: Rep[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await unwrap<RepPage>(api.GET('/v1/reps', { params: { query: { ...filters, page, limit: LOOKUP_LIMIT } } }));
    out.push(...res.data);
    if (page >= (res.meta.pageCount || 1)) break;
  }
  return out;
}
