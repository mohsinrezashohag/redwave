/**
 * Reps queries — the HRM rep roster (GET /v1/reps), server-paginated. Mirrors useProductsTable: the hook
 * owns page + sort state and sends them as query params; the table consumes { data, meta }. Read-only list
 * (this batch builds the roster view; rep CRUD is its own future screen). `hrm:view` server-enforced.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { useServerTable } from '../../../lib/query/useServerTable';
import { downloadFile } from '../../../lib/api/downloadFile';
import type { Rep, RepPage, RepSortKey, RepsFilters, RepsListParams, UpcomingBirthday } from '../reps.types';

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

/**
 * Which logins are already linked to a rep (login user id → that rep), for the rep form's "Linked login"
 * picker. Reads every rep of any status (the roster is small) so a terminated rep's login counts too.
 */
export function useLinkedLogins(enabled = true) {
  return useQuery({
    queryKey: [...repsListKeys.all, 'linked-logins'] as const,
    queryFn: async () => {
      const reps = await fetchAllReps({ status: 'all' });
      return new Map(reps.filter((r) => r.user_id).map((r) => [r.user_id as string, { id: r.id, rep_code: r.rep_code, full_name: r.full_name }]));
    },
    enabled,
  });
}

/** Birthdays in the next `days` days (GET /v1/reps/birthdays/upcoming, hrm:view). Month/day only. */
export function useUpcomingBirthdays(days = 30, enabled = true) {
  return useQuery({
    queryKey: [...repsListKeys.all, 'birthdays', days] as const,
    queryFn: () => unwrap<UpcomingBirthday[]>(api.GET('/v1/reps/birthdays/upcoming', { params: { query: { days } } })),
    enabled,
  });
}

/** Download the ZIP of rep photos for the current filters (hrm:edit, audited server-side). */
export function exportRepPhotos(filters: RepsFilters): Promise<void> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.fieldManagerId) qs.set('fieldManagerId', filters.fieldManagerId);
  if (filters.search) qs.set('search', filters.search);
  const query = qs.toString();
  return downloadFile(`/v1/reps/photos/export${query ? `?${query}` : ''}`);
}
