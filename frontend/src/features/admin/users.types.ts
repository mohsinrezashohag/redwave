/**
 * User-management types — RESPONSE shapes ALIASED to the generated OpenAPI schema (Batch A #2). Mirrors
 * `backend/src/modules/users/dto/user.response.ts`. REQUEST bodies are likewise typed from the schema.
 */
import type { components } from '../../api/generated/schema';

export type UserStatus = components['schemas']['AdminUserResponse']['status'];

/** A user's role membership as returned in the user list (effective perms = union of these roles). */
export type UserRoleRef = components['schemas']['UserRoleRefResponse'];

export type AdminUser = components['schemas']['AdminUserResponse'];

// Request bodies — typed from the generated schema.
export type CreateUserBody = components['schemas']['CreateUserDto'];
export type UpdateUserBody = components['schemas']['UpdateUserDto'];
export type SetUserRolesBody = components['schemas']['SetUserRolesDto'];
