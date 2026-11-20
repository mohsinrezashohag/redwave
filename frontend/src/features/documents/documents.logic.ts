/**
 * Pure documents helpers (no I/O). Drive ROW-LEVEL showability + a COMPOSED activity timeline from the
 * detail's nested data. None of this re-derives the overall status (that is the server's) — it only decides
 * which actions to OFFER (the server is the real gate) and presents events. #5/§13.
 */
import { ApiError } from '../../lib/api/apiError';
import type { Document, SignatureRequest } from './documents.types';

/**
 * The current user's row-level signability: find a PENDING signature for this user inside a PENDING request.
 * If present, the user is the asked signer and may Sign/Decline THAT request. Being the signer — not a
 * permission — is what authorizes signing (the server enforces).
 */
export function findMyPendingSignature(doc: Document, userId: string | undefined): { requestId: string; signatureId: string } | null {
  if (!userId) return null;
  for (const request of doc.signature_requests ?? []) {
    if (request.status !== 'pending') continue;
    const sig = request.document_signatures.find((s) => s.recipient_user_id === userId && s.status === 'pending');
    if (sig) return { requestId: request.id, signatureId: sig.id };
  }
  return null;
}

/** Cancel is requester / document-owner / admin, and only on a pending request (server-enforced). */
export function canCancel(request: SignatureRequest, doc: Document, userId: string | undefined, isAdmin: boolean): boolean {
  if (request.status !== 'pending') return false;
  return isAdmin || request.requested_by === userId || doc.owner_user_id === userId;
}

export type TimelineEvent = {
  key: string;
  at: string | null;
  actorId: string;
  kind: 'requested' | 'signed' | 'declined';
};

/**
 * Compose an activity timeline from the detail's requests + signatures (request created, each sign with its
 * `signed_at`, each decline). There is no audit-log endpoint and declines carry no timestamp in the response,
 * so a decline is listed without a time. DISPLAY only — not status derivation.
 */
export function buildTimeline(doc: Document): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const request of doc.signature_requests ?? []) {
    events.push({ key: `req-${request.id}`, at: request.created_at, actorId: request.requested_by, kind: 'requested' });
    for (const sig of request.document_signatures) {
      if (sig.status === 'signed') events.push({ key: `sig-${sig.id}`, at: sig.signed_at, actorId: sig.recipient_user_id, kind: 'signed' });
      else if (sig.status === 'declined') events.push({ key: `sig-${sig.id}`, at: null, actorId: sig.recipient_user_id, kind: 'declined' });
    }
  }
  // Newest first; events without a timestamp (declines / unstamped) sort last within their group.
  return events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

/** True when a thrown query/mutation error is a server 404 (a non-visible doc → graceful not-found). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

type SignField = SignatureRequest['signature_fields'][number];

/** Reading order of a signer's fields: page, then top-to-bottom, then left-to-right (drives "Next field"). */
export function orderFields<T extends Pick<SignField, 'page' | 'x' | 'y'>>(fields: T[]): T[] {
  return [...fields].sort((a, b) => a.page - b.page || Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x));
}

/**
 * A human label for each field. The API carries no field label, so a text field is named by its page
 * ("Text on page 2", numbered when a page has several). Pages are shown 1-based.
 */
export function fieldLabels(fields: Pick<SignField, 'id' | 'type' | 'page'>[]): Record<string, string> {
  const base: Record<SignField['type'], string> = { signature: 'Signature', initial: 'Initials', date: 'Date', text: 'Text' };
  const counts = new Map<string, number>();
  for (const f of fields) counts.set(`${f.type}:${f.page}`, (counts.get(`${f.type}:${f.page}`) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const f of fields) {
    const k = `${f.type}:${f.page}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    const suffix = (counts.get(k) ?? 0) > 1 ? ` (${n})` : '';
    out[f.id] = `${base[f.type]} on page ${f.page + 1}${suffix}`;
  }
  return out;
}

/** Recipients the requester asked to sign who got NO signature/initial box (warn before sending). */
export function recipientsWithoutSignature(
  recipientIds: string[],
  fields: { recipient_user_id: string; type: string }[],
): string[] {
  if (fields.length === 0) return []; // no placement at all = a plain click-to-sign request
  return recipientIds.filter((id) => !fields.some((f) => f.recipient_user_id === id && (f.type === 'signature' || f.type === 'initial')));
}
