/**
 * Account types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships `@ApiResponse`
 * DTOs as of Batch A #2). Mirrors `backend/src/modules/account/dto/account.response.ts`. REQUEST bodies are
 * likewise typed from the generated schema.
 */
import type { components } from '../../api/generated/schema';

/** The HR fields that can be changed via a profile-change request. */
export type ProfileChangeFields = components['schemas']['ProfileChangeFieldsResponse'];

export type PendingRequestSummary = components['schemas']['PendingRequestResponse'];

/** GET /v1/account/profile — the user's profile + whether a change is pending review. */
export type AccountProfile = components['schemas']['AccountProfileResponse'];

export type ProfileChangeStatus = components['schemas']['MyProfileRequestResponse']['status'];

/** A row from GET /v1/account/profile-change-requests (the user's own request history). */
export type MyProfileRequest = components['schemas']['MyProfileRequestResponse'];

// Request bodies — typed from the generated schema (the backend DID emit request DTOs).
export type ProfileChangeRequestBody = components['schemas']['ProfileChangeRequestDto'];
export type ChangePasswordBody = components['schemas']['ChangePasswordDto'];
