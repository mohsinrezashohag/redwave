/** Sales export log — pure display helpers (2026-11-11). */
import { displayDate } from '../../lib/format/date';
import type { SaleExportLog } from './api/useSaleExports';

/** "Status: paid · From 2026-11-01" — what narrowed an export, in words. Empty → "All sales". */
export function describeFilters(f: SaleExportLog['filters']): string {
  const parts: string[] = [];
  if (f.status) parts.push(`Status: ${f.status}`);
  if (f.date_from) parts.push(`From ${displayDate(f.date_from)}`);
  if (f.date_to) parts.push(`To ${displayDate(f.date_to)}`);
  if (f.client_id) parts.push('One client');
  if (f.rep_id) parts.push('One rep');
  if (f.search) parts.push(`Search: “${f.search}”`);
  return parts.length ? parts.join(' · ') : 'All sales';
}
