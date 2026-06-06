/**
 * Roles response DTOs — the role list (summary + counts), role detail (granted permissions), and the
 * RBAC catalogue (modules + permissions) that drives the role-builder matrix. — Batch A #2
 */
import { ApiProperty } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';

export class RoleCountResponse {
  @ApiProperty({ description: 'Permissions granted to this role.' })
  role_permissions!: number;

  @ApiProperty({ description: 'Users holding this role.' })
  user_roles!: number;
}

export class RoleSummaryResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Built-in roles cannot be renamed/deleted.' })
  is_system!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: () => RoleCountResponse })
  _count!: RoleCountResponse;
}

/** A permission granted to a role (id + the `moduleKey:action` key). */
export class RolePermissionRefResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'clients:view' })
  key!: string;
}

export class RoleDetailResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  is_system!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: () => [RolePermissionRefResponse] })
  permissions!: RolePermissionRefResponse[];
}

export class ModuleResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'clients' })
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
}

export class PermissionResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  module_id!: string;

  @ApiProperty({ example: 'clients' })
  module_key!: string;

  @ApiProperty({ enum: PermissionAction })
  action!: PermissionAction;

  @ApiProperty({ example: 'clients:view' })
  key!: string;
}
