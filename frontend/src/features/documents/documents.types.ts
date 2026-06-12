/**
 * Documents & E-Signature types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/documents/dto/document.response.ts`.
 * The overall status + each request/signature status are SERVER-DERIVED — the UI only DISPLAYS them. The
 * detail returns raw user IDs (names come from `useUsers`). REQUEST bodies typed from the schema.
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract.
export type DocType = components['schemas']['DocumentResponse']['doc_type'];
export type DocumentStatus = components['schemas']['DocumentResponse']['status'];
export type SignatureRequestStatus = components['schemas']['SignatureRequestResponse']['status'];
export type SignatureStatus = components['schemas']['DocumentSignatureResponse']['status'];
/** The sign/decline decision (request enum). */
export type SignDecision = 'sign' | 'decline';

/** One signer's row within a request. Per-signer signed copy; the original is never mutated (DOC-004). */
export type DocumentSignature = components['schemas']['DocumentSignatureResponse'];

export type SignatureRequest = components['schemas']['SignatureRequestResponse'];

export type Document = components['schemas']['DocumentResponse'];

export interface DocumentFilters {
  status?: DocumentStatus;
  doc_type?: DocType;
  pending_signatures?: boolean;
}

// Request bodies. The PDF uploads via POST /v1/files first (with progress); the JSON create then claims
// the stored path — so this body carries the local File + the metadata the two-step mutation needs.
export interface CreateDocumentBody {
  file: File;
  title: string;
  doc_type: DocType;
  /** Human-friendly name recorded on the stored file (defaults to the title). */
  display_name?: string;
  /** 0..100 upload progress for the modal's bar. */
  onProgress?: (pct: number) => void;
}
export type CreateSignatureRequestBody = components['schemas']['CreateSignatureRequestDto'];
export type SignBody = components['schemas']['SignDto'];

/** A placed signature field — request-body shape (normalized 0..1 fractions, top-left origin). */
export type SignatureFieldInput = NonNullable<CreateSignatureRequestBody['fields']>[number];
/** A placed field as returned on the document detail (server adds id + decimal-string coords). */
export type SignatureField = SignatureRequest['signature_fields'][number];
export type SignatureFieldType = SignatureFieldInput['type'];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  compensation_agreement: 'Compensation agreement',
  rate_notice: 'Rate notice',
  equipment: 'Equipment',
  other: 'Other',
};
