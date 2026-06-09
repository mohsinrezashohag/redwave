/**
 * Saved-signature hooks — the caller's OWN reusable signatures (server own-scopes every call; no module
 * permission). List + per-signature file-url (a short-TTL signed image URL) + create (multipart) / set
 * default / delete. — SRS §13 (saved signature)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { multipartPost } from '../../../lib/api/multipartUpload';
import type { components } from '../../../api/generated/schema';

export type UserSignature = components['schemas']['UserSignatureResponse'];
export type SignatureMethod = UserSignature['method'];

const keys = {
  all: ['account', 'signatures'] as const,
  fileUrl: (id: string) => ['account', 'signatures', 'file-url', id] as const,
};

export function useSignatures() {
  return useQuery({
    queryKey: keys.all,
    queryFn: () => unwrap<UserSignature[]>(api.GET('/v1/account/signatures')),
  });
}

export function useSignatureImageUrl(id: string | undefined) {
  return useQuery({
    queryKey: keys.fileUrl(id ?? ''),
    queryFn: () => unwrap<{ url: string; filename: string }>(api.GET('/v1/account/signatures/{id}/file-url', { params: { path: { id: id! } } })),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
}

export function useCreateSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, label, method }: { file: File; label: string; method: SignatureMethod }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      form.append('method', method);
      return multipartPost<UserSignature>('/v1/account/signatures', form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useSetDefaultSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<UserSignature>(api.PATCH('/v1/account/signatures/{id}/default', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useDeleteSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<unknown>(api.DELETE('/v1/account/signatures/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
