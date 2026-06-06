/**
 * Roles & permissions types — RESPONSE shapes ALIASED to the generated OpenAPI schema (Batch A #2). Mirrors
 * `backend/src/modules/roles/dto/role.response.ts`. The role builder is a module × action matrix: rows =
 * Modules, columns = the 6 actions, cells = Permission ids. REQUEST bodies typed from the generated schema.
 */
import type { components } from '../../api/generated/schema';

export type PermissionAction = components['schemas']['PermissionResponse']['action'];

/** The 6 actions in display order (the matrix columns). */
export const PERMISSION_ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'approve', 'delete', 'export'];

/** A role row in the list. */
export type RoleSummary = components['schemas']['RoleSummaryResponse'];

export type RolePermissionRef = components['schemas']['RolePermissionRefResponse'];

/** A single role with its granted permissions (GET /v1/roles/{id}). */
export type RoleDetail = components['schemas']['RoleDetailResponse'];

/** A module = a matrix ROW. */
export type Module = components['schemas']['ModuleResponse'];

/** A permission = one matrix CELL (a module×action pair with a stable id). */
export type Permission = components['schemas']['PermissionResponse'];

// Request bodies — typed from the generated schema.
export type CreateRoleBody = components['schemas']['CreateRoleDto'];
export type UpdateRoleBody = components['schemas']['UpdateRoleDto'];
export type SetRolePermissionsBody = components['schemas']['SetRolePermissionsDto'];
