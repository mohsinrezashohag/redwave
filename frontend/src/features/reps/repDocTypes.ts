/**
 * Rep document kinds + expiry — pure. Mirrors `backend/src/modules/hrm/rep-documents.logic.ts` (the server
 * re-checks everything with a 422). — client request 2026-11-12
 */

export const REP_DOC_TYPES = [
  { value: 'banking', label: 'Banking (void cheque / direct deposit)' },
  { value: 'headshot', label: 'Headshot (ID card photo)' },
  { value: 'work_permit', label: 'Work permit' },
  { value: 'study_permit', label: 'Study permit' },
  { value: 'pr_card', label: 'PR card' },
  { value: 'drivers_licence', label: "Driver's licence" },
  { value: 'passport', label: 'Passport' },
  { value: 'contract', label: 'Contract' },
  { value: 'other', label: 'Other' },
] as const;

/** Documents that expire: immigration status + government ID. */
export const EXPIRING_DOC_TYPES: ReadonlySet<string> = new Set(['work_permit', 'study_permit', 'pr_card', 'drivers_licence', 'passport']);

/** Short label for a stored type; an older free-text type shows as written. */
export function docTypeLabel(docType: string): string {
  const found = REP_DOC_TYPES.find((t) => t.value === docType);
  return found ? found.label.replace(/ \(.*\)$/, '') : docType;
}

/** What the file picker accepts: a headshot is a JPG/PNG photo; everything else PDF or image. */
export function acceptFor(docType: string): string {
  return docType === 'headshot' ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png';
}

/** How close a document is to expiring. Days are whole calendar days between 'YYYY-MM-DD' strings. */
export type ExpiryStatus = { kind: 'expired'; days: number } | { kind: 'soon'; days: number } | { kind: 'ok' } | null;

/** Warn this many days ahead — enough time to renew a permit. */
export const EXPIRY_WARNING_DAYS = 60;

export function expiryStatus(expiresOn: string | null | undefined, today: string): ExpiryStatus {
  if (!expiresOn) return null;
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const days = Math.round((day(expiresOn.slice(0, 10)) - day(today)) / 86_400_000);
  if (days < 0) return { kind: 'expired', days: -days };
  if (days <= EXPIRY_WARNING_DAYS) return { kind: 'soon', days };
  return { kind: 'ok' };
}
