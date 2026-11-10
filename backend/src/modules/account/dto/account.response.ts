/**
 * Account response DTOs — self-service profile, theme, and the profile-change review workflow. — Batch A #2
 * HR-field edits go through a review request (AUTH-011); `proposed_changes` is the KNOWN HR-field shape
 * (full_name/phone/avatar_url, all optional) — modeled precisely so the UI's typed field access keeps
 * working. (change-password returns the shared `SuccessResponse`.)
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProfileChangeStatus, ThemePreference, UserStatus } from '@prisma/client';

/** The HR fields a profile-change request may carry (each optional). */
export class ProfileChangeFieldsResponse {
  @ApiPropertyOptional({ type: String })
  full_name?: string;

  @ApiPropertyOptional({ type: String })
  phone?: string;

  @ApiPropertyOptional({ type: String })
  avatar_url?: string;

  // Rep-only (applied to the rep record on approval).
  @ApiPropertyOptional({ type: String })
  email?: string;

  @ApiPropertyOptional({ type: String })
  address_street?: string;

  @ApiPropertyOptional({ type: String })
  address_city?: string;

  @ApiPropertyOptional({ type: String })
  address_province?: string;

  @ApiPropertyOptional({ type: String })
  address_postal?: string;

  @ApiPropertyOptional({ type: String })
  jacket_size?: string;

  @ApiPropertyOptional({ type: String })
  tshirt_size?: string;
}

/** The pending request summary embedded on the profile (proposed values, not yet applied). */
export class PendingRequestResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: () => ProfileChangeFieldsResponse })
  proposed_changes!: ProfileChangeFieldsResponse;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

export class AccountProfileResponse {
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

  @ApiProperty({ description: 'True while an HR-field change awaits review.' })
  change_pending!: boolean;

  @ApiProperty({ type: () => PendingRequestResponse, nullable: true })
  pending_request!: PendingRequestResponse | null;
}

export class ThemeResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ThemePreference })
  theme_preference!: ThemePreference;
}

/** A caller's own profile-change request (history). */
export class MyProfileRequestResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ProfileChangeStatus })
  status!: ProfileChangeStatus;

  @ApiProperty({ type: () => ProfileChangeFieldsResponse })
  proposed_changes!: ProfileChangeFieldsResponse;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewed_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

/** The approve/reject result (the reviewed request). */
export class ProfileChangeRequestResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ProfileChangeStatus })
  status!: ProfileChangeStatus;

  @ApiProperty({ type: () => ProfileChangeFieldsResponse })
  proposed_changes!: ProfileChangeFieldsResponse;

  @ApiProperty({ type: String, nullable: true })
  reviewed_by!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewed_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

/** The subject (target user) of a review-queue request. */
export class ReviewSubjectResponse {
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

  @ApiProperty({
    type: () => ReviewSubjectRepResponse,
    nullable: true,
    description: "The subject's CURRENT rep-profile values, so the reviewer sees current → proposed. null when not a rep.",
  })
  rep!: ReviewSubjectRepResponse | null;
}

/** The rep fields a rep may request a change to — their current values, for the reviewer. */
export class ReviewSubjectRepResponse {
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  address_street!: string | null;

  @ApiProperty({ type: String, nullable: true })
  address_city!: string | null;

  @ApiProperty({ type: String, nullable: true })
  address_province!: string | null;

  @ApiProperty({ type: String, nullable: true })
  address_postal!: string | null;

  @ApiProperty({ type: String, nullable: true })
  jacket_size!: string | null;

  @ApiProperty({ type: String, nullable: true })
  tshirt_size!: string | null;
}

export class ReviewRequestResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: () => ProfileChangeFieldsResponse })
  proposed_changes!: ProfileChangeFieldsResponse;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty()
  requested_by!: string;

  @ApiProperty({ type: () => ReviewSubjectResponse })
  subject!: ReviewSubjectResponse;
}
