/**
 * Administration types — RESPONSE shapes ALIASED to the generated OpenAPI schema (Batch A #2). The
 * profile-change-review queue mirrors `backend/src/modules/account/dto/account.response.ts` (the review
 * controller + ScopeService routing).
 */
import type { components } from '../../api/generated/schema';

/** The HR fields a profile-change request may carry. */
export type ProfileChangeFields = components['schemas']['ProfileChangeFieldsResponse'];

/** The subject (whose profile would change) as returned on a queue row. */
export type ReviewSubject = components['schemas']['ReviewSubjectResponse'];

/** A pending profile-change request in the reviewer's (server-scoped) queue. */
export type ReviewRequest = components['schemas']['ReviewRequestResponse'];
