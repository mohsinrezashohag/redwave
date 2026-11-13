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
import type { DataAccuracy } from '../dataAccuracy';
import type {
  CreateEquipmentBody,
  CreateRepBody,
  DeletedRepDocument,
  DocumentRead,
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
  deletedDocuments: (id: string) => ['reps', 'one', id, 'documents', 'deleted'] as const,
  dataAccuracy: (id: string) => ['reps', 'one', id, 'data-accuracy'] as const,
};

/** The profile vs. ID comparison (2026-11-13, hrm:edit). */
export function useRepDataAccuracy(id: string) {
  return useQuery({
    queryKey: repKeys.dataAccuracy(id),
    queryFn: () => unwrap<DataAccuracy>(api.GET('/v1/reps/{id}/data-accuracy', { params: { path: { id } } })),
  });
}

/**
 * HR-confirmed ID details (2026-11-13). `document_number` is write-only: omitted = keep the one on file.
 * On a multipart upload / replace only the filled-in values are sent (a blank part can't mean "clear" there).
 */
export interface IdDetailsBody {
  name_on_document?: string | null;
  date_of_birth?: string | null;
  document_number?: string;
}

function appendIdDetails(form: FormData, d: IdDetailsBody | undefined) {
  if (d?.name_on_document) form.append('name_on_document', d.name_on_document);
  if (d?.date_of_birth) form.append('date_of_birth', d.date_of_birth);
  if (d?.document_number) form.append('document_number', d.document_number);
}

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
    mutationFn: ({
      file,
      docType,
      expiresOn,
      issuedOn,
      details,
    }: {
      file: File;
      docType: string;
      expiresOn?: string;
      issuedOn?: string;
      details?: IdDetailsBody;
    }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('doc_type', docType);
      if (expiresOn) form.append('expires_on', expiresOn);
      if (issuedOn) form.append('issued_on', issuedOn);
      appendIdDetails(form, details);
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

/** Decrypt the bank account number — hrm:edit; the server AUDITS every call (2026-11-12). Never cached. */
export function useRevealAccount() {
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<{ account_no: string | null }>(api.POST('/v1/reps/{id}/banking/reveal', { params: { path: { id } } })),
  });
}

/**
 * A short-lived URL for the rep's latest HEADSHOT, to show as their photo. HR reads it through the rep's
 * documents; the rep's own view through the token-scoped endpoint. null when there is no headshot.
 */
export function useHeadshotUrl(repId: string, docs: RepDocument[] | undefined, self: boolean, enabled = true) {
  const latest = (docs ?? [])
    .filter((d) => d.doc_type === 'headshot')
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0];
  return useQuery({
    queryKey: ['reps', 'headshot', repId, latest?.id ?? 'none', self],
    queryFn: async () =>
      (self
        ? await unwrap<{ url: string }>(api.GET('/v1/account/rep-profile/documents/{docId}/file-url', { params: { path: { docId: latest!.id } } }))
        : await unwrap<{ url: string }>(api.GET('/v1/reps/{id}/documents/{docId}/file-url', { params: { path: { id: repId, docId: latest!.id } } }))
      ).url,
    enabled: enabled && !!latest,
    staleTime: 45_000, // the signed URL lives ~60 s
  });
}

/** Upload a new HEADSHOT (the rep's photo) for any rep — hrm:edit. Used by the photo pen and the rep form. */
export function useUploadHeadshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repId, file }: { repId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('doc_type', 'headshot');
      return multipartPost<RepDocument>(`/v1/reps/${repId}/documents`, form);
    },
    onSuccess: (_d, { repId }) => qc.invalidateQueries({ queryKey: repKeys.documents(repId) }),
  });
}

/** The signed URL of a rep's latest headshot (null while loading / none / not allowed). */
export function useRepHeadshotUrl(repId: string | undefined, { self = false, canOpen }: { self?: boolean; canOpen: boolean }) {
  const adminDocs = useRepDocuments(repId, canOpen && !self);
  const ownDocs = useMyDocuments(self);
  const docs = (self ? ownDocs : adminDocs).data;
  return useHeadshotUrl(repId ?? '', docs, self, !!repId && (canOpen || self)).data ?? null;
}

/** Read an ID's dates BEFORE uploading it (hrm:edit). Nothing is stored; HR confirms. 2026-11-12 */
export function useReadDocumentUpload(repId: string) {
  return useMutation({
    mutationFn: ({ file, docType }: { file: File; docType: string }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('doc_type', docType);
      return multipartPost<DocumentRead>(`/v1/reps/${repId}/documents/read`, form);
    },
  });
}

/** Read an ID already on file (hrm:edit). */
export function useReadStoredDocument(repId: string) {
  return useMutation({
    mutationFn: (docId: string) =>
      unwrap<DocumentRead>(api.POST('/v1/reps/{id}/documents/{docId}/read', { params: { path: { id: repId, docId } } })),
  });
}

/**
 * Edit a document on file: its type and, for IDs, the HR-confirmed dates (hrm:edit, audited). `null` clears a
 * date; an omitted field is unchanged; a type without dates clears them server-side. 2026-11-12
 */
export function useUpdateRepDocument(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docId,
      ...body
    }: { docId: string; doc_type?: string; issued_on?: string | null; expires_on?: string | null } & IdDetailsBody) =>
      unwrap<RepDocument>(api.PATCH('/v1/reps/{id}/documents/{docId}', { params: { path: { id: repId, docId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.documents(repId) }),
  });
}

/** Replace a document's file (hrm:edit). The old file moves to Recently deleted, restorable for 30 days. */
export function useReplaceRepDocument(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docId,
      file,
      expiresOn,
      issuedOn,
      details,
    }: {
      docId: string;
      file: File;
      expiresOn?: string;
      issuedOn?: string;
      details?: IdDetailsBody;
    }) => {
      const form = new FormData();
      form.append('file', file);
      if (expiresOn) form.append('expires_on', expiresOn);
      if (issuedOn) form.append('issued_on', issuedOn);
      appendIdDetails(form, details);
      return multipartPost<RepDocument>(`/v1/reps/${repId}/documents/${docId}/replace`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.documents(repId) }),
  });
}

/** Move a document to Recently deleted (hrm:delete). */
export function useDeleteRepDocument(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      unwrap<{ success: boolean; purge_on: string }>(
        api.DELETE('/v1/reps/{id}/documents/{docId}', { params: { path: { id: repId, docId } } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.documents(repId) }),
  });
}

/** The rep's Recently deleted documents (hrm:delete). */
export function useDeletedRepDocuments(repId: string, enabled = true) {
  return useQuery({
    queryKey: repKeys.deletedDocuments(repId),
    queryFn: () =>
      unwrap<DeletedRepDocument[]>(api.GET('/v1/reps/{id}/documents/deleted', { params: { path: { id: repId } } })),
    enabled: enabled && !!repId,
  });
}

/** Bring a document back from Recently deleted (hrm:delete; 409 after 30 days). */
export function useRestoreRepDocument(repId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      unwrap<RepDocument>(api.POST('/v1/reps/{id}/documents/{docId}/restore', { params: { path: { id: repId, docId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.documents(repId) }),
  });
}
