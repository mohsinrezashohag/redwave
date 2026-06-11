/**
 * Report-export hooks — the recent-exports list + the recording mutation (/v1/report-exports; RPT-015).
 * Recording happens BEFORE the client-side file generation (no record → no file); the server enforces the
 * per-type permission (403 + audit on denial) — the page's type filtering is convenience only (§5).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import type { CreateReportExportBody, ReportExport } from '../reports.types';

export const reportExportKeys = {
  all: ['report-exports'] as const,
  list: () => ['report-exports', 'list'] as const,
};

/** Latest recorded exports — own for non-admin, all for Admin/SA (scoped server-side). */
export function useReportExports(enabled = true) {
  return useQuery({
    queryKey: reportExportKeys.list(),
    queryFn: () => unwrapList<ReportExport>(api.GET('/v1/report-exports')),
    enabled,
  });
}

export function useRecordReportExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReportExportBody) => unwrap<ReportExport>(api.POST('/v1/report-exports', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportExportKeys.all }),
  });
}
