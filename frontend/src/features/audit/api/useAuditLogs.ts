/**
 * Audit-log queries — the SA audit view (server-paginated) + the per-record History feed. Read-only;
 * gated server-side by audit:view. Empty filter values are stripped so they aren't sent. — arch §security
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { useServerTable } from '../../../lib/query/useServerTable';
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

/**
 * Server-driven list state (page + sort + filters) for the audit DataTable — via the shared `useServerTable`.
 * Audit defaults to newest-first and opens a NEW sort column descending (`newColumnDir: 'desc'`).
 */
export function useAuditTable(filters: AuditFilters, enabled = true) {
  return useServerTable<AuditLog, AuditSortKey>({
    queryKey: (p) => auditKeys.page({ ...filters, ...p } as AuditListParams),
    fetchPage: (p) =>
      unwrap<AuditLogPage>(api.GET('/v1/audit-logs', { params: { query: clean({ ...filters, ...p } as AuditListParams) } })),
    defaultSort: { key: 'created_at', dir: 'desc' },
    filterKey: JSON.stringify(filters),
    limit: LIMIT,
    enabled,
    newColumnDir: 'desc',
  });
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
