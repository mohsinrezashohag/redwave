/**
 * Rep PROFILE queries + mutations — one rep, create/edit, the audited SIN reveal, equipment (iPad etc.)
 * and documents. All `hrm:*` gated server-side (§5); the hooks are convenience only. PII arrives already
 * redacted for callers without hrm:edit. Mutations invalidate the rep's caches; toasts are the caller's.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { multipartPost } from '../../../lib/api/multipartUpload';
import { repsListKeys } from './useReps';
import type {
  CreateEquipmentBody,
  CreateRepBody,
  Rep,
  RepDocument,
  RepEquipment,
  MyRepProfile,
  RevealSin,
  UpdateEquipmentBody,
  UpdateRepBody,
} from '../reps.types';

export const repKeys = {
  one: (id: string) => ['reps', 'one', id] as const,
  equipment: (id: string) => ['reps', 'one', id, 'equipment'] as const,
  documents: (id: string) => ['reps', 'one', id, 'documents'] as const,
};

export function useRep(id: string | undefined) {
  return useQuery({
    queryKey: repKeys.one(id ?? ''),
    queryFn: () => unwrap<Rep>(api.GET('/v1/reps/{id}', { params: { path: { id: id as string } } })),
    enabled: !!id,
  });
}

export function useCreateRep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRepBody) => unwrap<Rep>(api.POST('/v1/reps', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repsListKeys.all }),
  });
}

export function useUpdateRep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRepBody }) =>
      unwrap<Rep>(api.PATCH('/v1/reps/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repsListKeys.all }),
  });
}

/** Decrypt the SIN — hrm:edit, and the server AUDITS every call. Never cached: each reveal is deliberate. */
export function useRevealSin() {
  return useMutation({
    mutationFn: (id: string) => unwrap<RevealSin>(api.POST('/v1/reps/{id}/sin/reveal', { params: { path: { id } } })),
  });
}

export function useRepEquipment(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: repKeys.equipment(id ?? ''),
    queryFn: () => unwrap<RepEquipment[]>(api.GET('/v1/reps/{id}/equipment', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
  });
}

export function useAssignEquipment(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEquipmentBody) =>
      unwrap<RepEquipment>(api.POST('/v1/reps/{id}/equipment', { params: { path: { id: repId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.equipment(repId) }),
  });
}

export function useUpdateEquipment(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateEquipmentBody }) =>
      unwrap<RepEquipment>(api.PATCH('/v1/equipment/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.equipment(repId) }),
  });
}

export function useRepDocuments(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: repKeys.documents(id ?? ''),
    queryFn: () => unwrap<RepDocument[]>(api.GET('/v1/reps/{id}/documents', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
  });
}

/** Upload a PDF/image against the rep (multipart: `file` + `doc_type`). hrm:edit. */
export function useUploadRepDocument(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, docType }: { file: File; docType: string }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('doc_type', docType);
      return multipartPost<RepDocument>(`/v1/reps/${repId}/documents`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.documents(repId) }),
  });
}

/** A short-lived signed URL for one document (hrm:edit). */
export function useRepDocumentUrl(repId: string) {
  return useMutation({
    mutationFn: (docId: string) =>
      unwrap<{ url: string }>(
        api.GET('/v1/reps/{id}/documents/{docId}/file-url', { params: { path: { id: repId, docId } } }),
      ),
  });
}

// ── The signed-in REP's own profile (read-only; the rep comes from the token — no id is sent) ─────────

export const myRepKeys = {
  profile: ['account', 'rep-profile'] as const,
  equipment: ['account', 'rep-profile', 'equipment'] as const,
  documents: ['account', 'rep-profile', 'documents'] as const,
};

export function useMyRepProfile(enabled = true) {
  return useQuery({
    queryKey: myRepKeys.profile,
    queryFn: () => unwrap<MyRepProfile>(api.GET('/v1/account/rep-profile')),
    enabled,
  });
}

export function useMyEquipment(enabled = true) {
  return useQuery({
    queryKey: myRepKeys.equipment,
    queryFn: () => unwrap<RepEquipment[]>(api.GET('/v1/account/rep-profile/equipment')),
    enabled,
  });
}

export function useMyDocuments(enabled = true) {
  return useQuery({
    queryKey: myRepKeys.documents,
    queryFn: () => unwrap<RepDocument[]>(api.GET('/v1/account/rep-profile/documents')),
    enabled,
  });
}

export function useMyDocumentUrl() {
  return useMutation({
    mutationFn: (docId: string) =>
      unwrap<{ url: string }>(api.GET('/v1/account/rep-profile/documents/{docId}/file-url', { params: { path: { docId } } })),
  });
}
