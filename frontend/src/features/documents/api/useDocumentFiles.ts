/**
 * File-URL hooks — fetch a short-TTL signed URL for a stored file via an RBAC/visibility-gated endpoint
 * (the bytes are never public). Used by the preview + download. The URL expires, so these are not cached
 * long (`staleTime: 0`, low gcTime) and refetch on demand. — SRS DOC-002 (access-controlled)
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';

export interface FileUrl {
  url: string;
  filename: string;
}

const FILE_OPTS = { staleTime: 0, gcTime: 30_000, retry: false } as const;

/** The original document file. */
export function useDocumentFileUrl(documentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['documents', 'file-url', documentId],
    queryFn: () => unwrap<FileUrl>(api.GET('/v1/documents/{id}/file-url', { params: { path: { id: documentId! } } })),
    enabled: !!documentId && enabled,
    ...FILE_OPTS,
  });
}

/** The final all-signatures copy (404 until completed). */
export function useCompletedFileUrl(documentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['documents', 'completed-file-url', documentId],
    queryFn: () => unwrap<FileUrl>(api.GET('/v1/documents/{id}/completed-file-url', { params: { path: { id: documentId! } } })),
    enabled: !!documentId && enabled,
    ...FILE_OPTS,
  });
}

/** A per-signer signed copy. */
export function useSignatureFileUrl(signatureId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['documents', 'signature-file-url', signatureId],
    queryFn: () => unwrap<FileUrl>(api.GET('/v1/signatures/{id}/file-url', { params: { path: { id: signatureId! } } })),
    enabled: !!signatureId && enabled,
    ...FILE_OPTS,
  });
}
