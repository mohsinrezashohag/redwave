/**
 * Sales export log — client request 2026-11-11. Redwave exports sales whenever they like and works in Excel,
 * so every export is RECORDED server-side first (who / when / format / filters / row count + exactly which
 * sales) and the file is built from the rows the server returns. "Only new" = sales never exported before
 * (company-wide), so nothing is counted twice. All `sales:export`, scoped server-side like the list (§5).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import type { components } from '../../../api/generated/schema';
import type { ExportFormat } from '../../../lib/export/exportRows';
import type { SalesFilters } from '../sales.types';

export type SaleExportLog = components['schemas']['SaleExportLogResponse'];
export type SaleExportPage = components['schemas']['SaleExportPageResponse'];
export type SaleExportSummary = components['schemas']['SaleExportSummaryResponse'];
export type SaleExportResult = components['schemas']['SaleExportResultResponse'];

export const saleExportKeys = {
  all: ['sales', 'exports'] as const,
  summary: (filters: SalesFilters) => ['sales', 'exports', 'summary', filters] as const,
  history: (page: number) => ['sales', 'exports', 'history', page] as const,
};

/** The browser's format name → the server's ('xlsx' is recorded as 'excel'). */
export const serverFormat = (f: ExportFormat): 'csv' | 'excel' | 'pdf' => (f === 'xlsx' ? 'excel' : f);

/** Only the list filters that are set — the server records exactly what narrowed the export. */
export function exportFilters(filters: SalesFilters): SalesFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '')) as SalesFilters;
}

export function useSaleExportSummary(filters: SalesFilters, enabled = true) {
  const f = exportFilters(filters);
  return useQuery({
    queryKey: saleExportKeys.summary(f),
    queryFn: () => unwrap<SaleExportSummary>(api.GET('/v1/sales/exports/summary', { params: { query: f } })),
    enabled,
  });
}

export function useSaleExportHistory(page: number, enabled = true) {
  return useQuery({
    queryKey: saleExportKeys.history(page),
    queryFn: () => unwrap<SaleExportPage>(api.GET('/v1/sales/exports', { params: { query: { page, limit: 10 } } })),
    enabled,
  });
}

/** Record the export and get its rows back; refreshes "last exported", the counts and the history. */
export function useRecordSaleExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { format: ExportFormat; filename: string; filters: SalesFilters; onlyNew: boolean }) =>
      unwrap<SaleExportResult>(
        api.POST('/v1/sales/exports', {
          body: {
            format: serverFormat(body.format),
            filename: body.filename,
            filters: exportFilters(body.filters),
            only_new: body.onlyNew,
          },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: saleExportKeys.all }),
  });
}
