/**
 * Import mutations — REAL multipart upload + remap + reconcile + commit + mapping CRUD. The UI does NO
 * matching/commit logic: STAGE uploads a file (the backend parses/cleans/auto-maps/classifies); REMAP
 * re-applies an adjusted mapping; RECONCILE asks the backend to match/edit/ignore; COMMIT is the backend's
 * ATOMIC + IDEMPOTENT apply (#8), gated server-side. All invalidate the import cache. Toasts at the call site.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { multipartPost } from '../../../lib/api/multipartUpload';
import { getAccessToken } from '../../../api/auth-store';
import { ApiError } from '../../../lib/api/apiError';
import { importKeys } from './keys';
import type {
  CreateMappingBody,
  ImportBatch,
  ImportFieldMapping,
  ImportSourceType,
  ImportType,
  ReconcileBody,
  RemapBody,
  StagedImport,
} from '../import.types';

export interface StageInput {
  file: File;
  source_type: ImportSourceType;
  import_type: ImportType;
  client_id?: string;
  field_mapping_id?: string;
  reconcile_total?: string;
}

export function useStageImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StageInput) => {
      const form = new FormData();
      form.append('file', input.file);
      form.append('source_type', input.source_type);
      form.append('import_type', input.import_type);
      if (input.client_id) form.append('client_id', input.client_id);
      if (input.field_mapping_id) form.append('field_mapping_id', input.field_mapping_id);
      if (input.reconcile_total) form.append('reconcile_total', input.reconcile_total);
      return multipartPost<StagedImport>('/v1/imports', form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useRemap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RemapBody }) =>
      unwrap<StagedImport>(api.POST('/v1/imports/{id}/remap', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReconcileBody }) =>
      unwrap<ImportBatch>(api.POST('/v1/imports/{id}/reconcile', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<ImportBatch>(api.POST('/v1/imports/{id}/commit', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useSaveMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMappingBody) => unwrap<ImportFieldMapping>(api.POST('/v1/import-mappings', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: importKeys.mappings() }),
  });
}

/** Download the per-row error report (CSV) for a batch — a raw GET (text), triggers a browser download. */
export async function downloadErrorReport(id: string): Promise<void> {
  const base = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const token = getAccessToken();
  const res = await fetch(`${base}/v1/imports/${id}/error-report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Could not download the error report (${res.status})`);
  }
  const blob = new Blob([await res.text()], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-errors-${id.slice(0, 8)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
