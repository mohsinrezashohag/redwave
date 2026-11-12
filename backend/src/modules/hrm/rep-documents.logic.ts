/**
 * Rep document rules — PURE (no Nest, no Prisma). — client request 2026-11-12
 *
 * The kinds of document HR keeps against a rep. New uploads must use one of these keys; rows uploaded before
 * the list existed keep their free-text type and still display. Identity, immigration and banking documents
 * are as sensitive as the SIN: opening one needs hrm:edit (or it is the rep's own), and the row's storage
 * path is redacted for everyone else (HRM-008).
 */

export const REP_DOC_TYPES = [
  'banking', // void cheque / direct deposit form
  'headshot', // photo for the rep's ID card
  'work_permit',
  'study_permit',
  'pr_card',
  'drivers_licence',
  'passport',
  'contract',
  'other',
] as const;
export type RepDocType = (typeof REP_DOC_TYPES)[number];

/** Document kinds that carry an expiry date (immigration status + government ID). */
export const EXPIRING_DOC_TYPES: ReadonlySet<string> = new Set([
  'work_permit',
  'study_permit',
  'pr_card',
  'drivers_licence',
  'passport',
]);

const IMAGE_ONLY = /^image\/(png|jpe?g)$/;

/**
 * Why this upload is not acceptable, or null when it is. Checked on top of the generic file-type check
 * (PDF / image): a HEADSHOT must be a JPG or PNG photo (it becomes the ID-card picture), and an expiry date
 * only makes sense on a document that actually expires.
 */
export function repDocumentProblem(
  docType: string,
  mimetype: string,
  expiresOn: string | undefined | null,
  issuedOn?: string | null,
): string | null {
  if (!(REP_DOC_TYPES as readonly string[]).includes(docType)) {
    return `Unknown document type '${docType}'. Use one of: ${REP_DOC_TYPES.join(', ')}`;
  }
  if (docType === 'headshot' && !IMAGE_ONLY.test(mimetype)) {
    return 'A headshot must be a JPG or PNG photo';
  }
  if ((expiresOn || issuedOn) && !EXPIRING_DOC_TYPES.has(docType)) {
    return 'Only permits, PR cards, driver’s licences and passports carry issue and expiry dates';
  }
  if (issuedOn && expiresOn && issuedOn >= expiresOn) {
    return 'The expiry date must be after the issue date';
  }
  return null;
}

// ── Recently deleted (2026-11-12) ───────────────────────────────────────────────────────────────
// A deleted document stays restorable for this many days; then the daily purge removes the stored object and
// the row for good, to free storage. One constant so the UI's "removed for good on" and the purge agree.

export const DELETED_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When a document deleted at `deletedAt` is removed for good. */
export function purgeDueDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + DELETED_RETENTION_DAYS * DAY_MS);
}

/** Documents deleted before this instant are due for the purge (and can no longer be restored). */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - DELETED_RETENTION_DAYS * DAY_MS);
}

/** Still inside the 30-day window, so it can be restored. */
export function isRestorable(deletedAt: Date, now: Date): boolean {
  return purgeDueDate(deletedAt).getTime() > now.getTime();
}
