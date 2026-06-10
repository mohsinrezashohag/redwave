/**
 * Audit types — aliased to the generated OpenAPI schema. The audit log is READ-ONLY (append-only on the
 * server); the SA views it via /v1/audit-logs (audit:view), and the same endpoint (filtered by entity)
 * powers the per-record History tab. — arch §security (audit)
 */
import type { components } from '../../api/generated/schema';

export type AuditLog = components['schemas']['AuditLogResponse'];
export type AuditLogPage = components['schemas']['AuditLogPageResponse'];

export type AuditSortKey = 'created_at' | 'action' | 'entity_type';

export interface AuditFilters {
  actor_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface AuditListParams extends AuditFilters {
  page: number;
  limit: number;
  sort: string;
}
