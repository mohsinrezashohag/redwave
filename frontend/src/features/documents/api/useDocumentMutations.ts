/**
 * Documents mutations — REAL multipart upload, the unified share/request-signature (with placed fields),
 * row-level sign (stamp) / decline / sign-upload, and cancel. Sign/cancel/sign-upload carry NO permission —
 * they are gated row-level server-side (a non-signer → 403; non-pending → 409). All invalidate the
 * documents cache. Toasts at the call site.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { multipartPost } from '../../../lib/api/multipartUpload';
import { documentKeys } from './keys';
import type { CreateDocumentBody, CreateSignatureRequestBody, Document, SignBody, SignatureRequest } from '../documents.types';

/** Real multipart upload — a PDF + title + doc_type → POST /v1/documents (the original is stored once). */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, title, doc_type }: CreateDocumentBody) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title);
      form.append('doc_type', doc_type);
      return multipartPost<Document>('/v1/documents', form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}

/** Share == request a signature (DOC-002): recipients become the shared-with set AND the asked signers. */
export function useRequestSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, body }: { documentId: string; body: CreateSignatureRequestBody }) =>
      unwrap<SignatureRequest>(api.POST('/v1/documents/{id}/signature-requests', { params: { path: { id: documentId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}

/** Sign (stamp) or decline — row-level (must be the asked pending recipient; the server is the real gate). */
export function useSignRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: SignBody }) =>
      unwrap<unknown>(api.POST('/v1/signature-requests/{id}/sign', { params: { path: { id: requestId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}

/** Complete a signature by uploading an externally-signed PDF (method = uploaded) — row-level. */
export function useSignUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, file }: { requestId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return multipartPost<unknown>(`/v1/signature-requests/${requestId}/sign-upload`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}

/** Cancel a pending request — requester / owner / admin (row-level). All-cancelled → doc back to draft. */
export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => unwrap<unknown>(api.POST('/v1/signature-requests/{id}/cancel', { params: { path: { id: requestId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}
