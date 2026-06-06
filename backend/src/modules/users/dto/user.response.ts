/**
 * Users response DTO — admin user management. Mirrors USER_WITH_ROLES_SELECT (public fields + nested
 * role refs). No password hash is ever selected/returned. — Batch A #2
 */
import { ApiProperty } from '@nestjs/swagger';
import { ThemePreference, UserStatus } from '@prisma/client';

export class UserRoleRoleResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class UserRoleRefResponse {
  @ApiProperty({ type: () => UserRoleRoleResponse })
  role!: UserRoleRoleResponse;
}

export class AdminUserResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  full_name!: string;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatar_url!: string | null;

  @ApiProperty({ enum: ThemePreference })
  theme_preference!: ThemePreference;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;

  @ApiProperty({ type: () => [UserRoleRefResponse] })
  user_roles!: UserRoleRefResponse[];
}
