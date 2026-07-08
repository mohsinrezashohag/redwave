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
  'product_types', // the configurable product-type catalogue (engine-config); own row so it's independently grantable
  'sales',
  'payrun',
  'clawback',
  'expenses',
  'km_rates', // per-client effective-dated kilometre rate config (rep reimbursement + client bill); own row
  'billing',
  'documents',
  'import',
  'reports',
  'settings',
  'notifications', // gates the manual broadcast (notifications:broadcast); per-user reads stay self-scoped
  'audit', // the append-only audit trail — audit:view/export gate the SA audit log; Super Admin only by default
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
