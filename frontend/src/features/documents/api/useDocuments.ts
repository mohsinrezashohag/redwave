/**
 * Documents queries — READ-ONLY, VISIBILITY-SCOPED server-side (owner-or-recipient; Admin/Super see all).
 * The list returns only visible docs; a non-visible detail fetch → 404 (the UI shows a graceful not-found,
 * never a permission error). Responses are `never`-typed → cast to the hand-written types.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { documentKeys } from './keys';
import type { Document, DocumentFilters } from '../documents.types';

export function useDocuments(filters: DocumentFilters = {}, enabled = true) {
  return useQuery({
    queryKey: documentKeys.list(filters),
    queryFn: () => unwrapList<Document>(api.GET('/v1/documents', { params: { query: filters } })),
    enabled,
  });
}

export function useDocument(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: documentKeys.document(id ?? ''),
    queryFn: () => unwrap<Document>(api.GET('/v1/documents/{id}', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
    retry: false, // a 404 (not visible) is a final answer — don't retry into a graceful not-found
  });
}
