/**
 * Export-layout hooks. The registry drives the picker; saving is validated server-side and a 422 carries
 * the named reasons (a foreign field, a broken money block, a missing required column).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import type { ExportLayout, ExportRegistryEntry, SaveExportLayoutBody } from '../exportLayouts.types';

export const exportLayoutKeys = {
  all: ['export-layouts'] as const,
  registry: () => ['export-layouts', 'registry'] as const,
  list: (reportType?: string) => ['export-layouts', 'list', reportType ?? 'all'] as const,
};

export function useExportRegistry(enabled = true) {
  return useQuery({
    queryKey: exportLayoutKeys.registry(),
    queryFn: () => unwrapList<ExportRegistryEntry>(api.GET('/v1/export-layouts/registry')),
    enabled,
  });
}

export function useExportLayouts(reportType?: string, enabled = true) {
  return useQuery({
    queryKey: exportLayoutKeys.list(reportType),
    queryFn: () =>
      unwrapList<ExportLayout>(
        api.GET('/v1/export-layouts', { params: { query: { report_type: reportType } } }),
      ),
    enabled,
  });
}

export function useSaveExportLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveExportLayoutBody) =>
      unwrap<ExportLayout>(api.POST('/v1/export-layouts', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: exportLayoutKeys.all }),
  });
}
