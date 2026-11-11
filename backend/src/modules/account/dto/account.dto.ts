import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ThemePreference } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CLOTHING_SIZES, PROVINCES } from '../../hrm/rep-profile.logic';

export class ChangePasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  current_password!: string;

  @ApiProperty({ writeOnly: true, minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new_password!: string;
}

export class SetThemeDto {
  @ApiProperty({
    enum: ThemePreference,
    description: 'Applies immediately — no review (AUTH-010).',
  })
  @IsEnum(ThemePreference)
  theme_preference!: ThemePreference;
}

/** A request to change profile HR fields. At least one field is required (validated in the service). */
export class ProfileChangeRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  full_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({
    description:
      'The new photo: the storage path returned by POST /v1/files (purpose=avatar, JPG/PNG), or "" to remove it. Links are not accepted. Not available to reps — their photo is their HR headshot.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  avatar_url?: string;

  // ── Rep-only fields (client request 2026-11-11). Accepted only from a user linked to a rep; applied to
  // the REP record on approval. Rep code, status, dates, manager, DOB, SIN, equipment and documents are
  // ADMIN-ONLY and deliberately absent here — a rep cannot even request them. ──

  @ApiPropertyOptional({ description: 'Rep contact email (not the login email).' })
  @IsOptional()
  @IsEmail({}, { message: 'email must be an email address' })
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_street?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_city?: string;

  @ApiPropertyOptional({ enum: PROVINCES })
  @IsOptional()
  @IsIn([...PROVINCES])
  address_province?: string;

  @ApiPropertyOptional({ example: 'R3G 0T7' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  address_postal?: string;

  @ApiPropertyOptional({ enum: CLOTHING_SIZES })
  @IsOptional()
  @IsIn([...CLOTHING_SIZES])
  jacket_size?: string;

  @ApiPropertyOptional({ enum: CLOTHING_SIZES })
  @IsOptional()
  @IsIn([...CLOTHING_SIZES])
  tshirt_size?: string;
}
