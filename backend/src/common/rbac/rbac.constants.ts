/**
 * RBAC catalogue constants — the module keys, actions, and built-in role names.
 * Used by the seed (to create the permission grid + roles) and by the guards/services.
 * — SRS AUTH-003/004/007, arch §6/§7.
 */
import { PermissionAction } from '@prisma/client';

/** The system modules access can be granted against (data-model `modules.key`). */
export const MODULE_KEYS = [
  'users',
  'roles',
  'profile',
  'hrm',
  'clients',
  'billing_rates', // sensitive partner billing rate cards — view/manage gated separately (Super Admin only)
  'commission',
  'sales',
  'payrun',
  'clawback',
  'expenses',
  'billing',
  'documents',
  'import',
  'reports',
  'settings',
  'notifications', // gates the manual broadcast (notifications:broadcast); per-user reads stay self-scoped
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The six permission actions (data-model `permissions.action`). — AUTH-004 */
export const ALL_ACTIONS: PermissionAction[] = [
  'view',
  'create',
  'edit',
  'approve',
  'delete',
  'export',
];

/** Built-in (system) role names. These rows are is_system=true and cannot be deleted. — AUTH-003/007 */
export const BUILTIN_ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALES_REP: 'Sales Rep',
} as const;
