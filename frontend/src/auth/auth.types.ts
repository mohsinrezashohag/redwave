/**
 * Auth response types — ALIASED to the generated OpenAPI schema (the backend ships `@ApiResponse` DTOs as
 * of Batch A #2). Mirrors `backend/src/modules/auth/dto/auth.response.ts`. The type names are kept so the
 * session/provider call sites compile unchanged.
 */
import type { components } from '../api/generated/schema';

export type PublicUser = components['schemas']['MeUserResponse'];

export type LoginResponse = components['schemas']['LoginResponse'];

export type RefreshResponse = components['schemas']['RefreshResponse'];

export type MeResponse = components['schemas']['MeResponse'];
