/**
 * Audit-log queries — the SA audit view (server-paginated) + the per-record History feed. Read-only;
 * gated server-side by audit:view. Empty filter values are stripped so they aren't sent. — arch §security
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import type { AuditFilters, AuditListParams, AuditLog, AuditLogPage, AuditSortKey } from '../audit.types';

const LIMIT = 25;

const auditKeys = {
  all: ['audit'] as const,
  page: (params: AuditListParams) => ['audit', 'list', params] as const,
  history: (entityType: string, entityId: string) => ['audit', 'history', entityType, entityId] as const,
};

/** Drop empty strings so they don't become `?entity_type=` etc. */
function clean(params: AuditListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) out[k] = v as string | number;
  }
  return out;
}

export function useAuditPage(params: AuditListParams, enabled = true) {
  return useQuery({
    queryKey: auditKeys.page(params),
    queryFn: () => unwrap<AuditLogPage>(api.GET('/v1/audit-logs', { params: { query: clean(params) } })),
    enabled,
  });
}

/** Server-driven list state (page + sort + filters) for the audit DataTable. */
export function useAuditTable(filters: AuditFilters, enabled = true) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: AuditSortKey; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' });
  const filterKey = JSON.stringify(filters);
  const sortKey = `${sort.key}:${sort.dir}`;
  useEffect(() => setPage(1), [filterKey, sortKey]);

  const query = useAuditPage({ ...filters, page, limit: LIMIT, sort: sortKey }, enabled);
  const meta = query.data?.meta;
  const toggleSort = (key: AuditSortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  return {
    rows: query.data?.data ?? [],
    total: meta?.total ?? 0,
    page,
    pageCount: Math.max(1, meta?.pageCount ?? 1),
    limit: LIMIT,
    setPage,
    sort,
    toggleSort,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** The history of ONE record (newest first) — powers the detail-screen History tab. */
export function useRecordHistory(entityType: string, entityId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: auditKeys.history(entityType, entityId ?? ''),
    queryFn: () =>
      unwrap<AuditLogPage>(
        api.GET('/v1/audit-logs', {
          params: { query: { entity_type: entityType, entity_id: entityId!, limit: 50, sort: 'created_at:desc' } },
        }),
      ),
    enabled: enabled && !!entityId,
    select: (p): AuditLog[] => p.data,
  });
}
