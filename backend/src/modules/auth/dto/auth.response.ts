/**
 * Auth response DTOs — login/refresh token pairs + the `/me` profile bundle. — Batch A #2
 * (logout returns the shared `SuccessResponse`.)
 */
import { ApiProperty } from '@nestjs/swagger';
import { ThemePreference, UserStatus } from '@prisma/client';

export class LoginResponse {
  @ApiProperty({ description: 'Short-lived access JWT (Bearer).' })
  access_token!: string;

  @ApiProperty({ description: 'Long-lived refresh JWT.' })
  refresh_token!: string;
}

export class RefreshResponse {
  @ApiProperty()
  access_token!: string;
}

/** The public user profile (no password hash) embedded in `/me`. */
export class MeUserResponse {
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
}

export class MeResponse {
  @ApiProperty({ type: () => MeUserResponse })
  user!: MeUserResponse;

  @ApiProperty({ type: [String], description: 'Role names held by the user.' })
  roles!: string[];

  @ApiProperty()
  is_super_admin!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Linked rep id, if the user is also a rep.' })
  rep_id!: string | null;

  @ApiProperty({ type: [String], description: 'Union of the user roles’ permission keys (moduleKey:action).' })
  effective_permissions!: string[];
}
