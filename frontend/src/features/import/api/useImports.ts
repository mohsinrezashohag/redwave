/**
 * Import queries — READ-ONLY. The list returns batch headers; the detail returns the batch + its staged rows.
 * Responses are `never`-typed in the contract → cast to the hand-written types.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { importKeys } from './keys';
import type { ImportBatch, ImportFieldMapping, ImportFilters, ImportSourceType } from '../import.types';

/** Saved field mappings (optionally scoped to a source type). */
export function useImportMappings(source_type?: ImportSourceType, enabled = true) {
  return useQuery({
    queryKey: importKeys.mappings(),
    queryFn: () => unwrap<ImportFieldMapping[]>(api.GET('/v1/import-mappings', { params: { query: source_type ? { source_type } : {} } })),
    enabled,
  });
}

export function useImports(filters: ImportFilters = {}, enabled = true) {
  return useQuery({
    queryKey: importKeys.list(filters),
    queryFn: () => unwrap<ImportBatch[]>(api.GET('/v1/imports', { params: { query: filters } })),
    enabled,
  });
}

export function useImportBatch(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: importKeys.batch(id ?? ''),
    queryFn: () => unwrap<ImportBatch>(api.GET('/v1/imports/{id}', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
    retry: false,
  });
}
