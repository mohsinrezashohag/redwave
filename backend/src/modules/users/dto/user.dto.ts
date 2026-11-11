import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'jane@redwave.local' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    writeOnly: true,
    minLength: 8,
    maxLength: 128,
    description: 'Omit to INVITE the user — they receive an email link to set their own password.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  full_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ type: [String], description: 'Role ids to assign on creation.' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  role_ids?: string[];
}

export class UpdateUserDto {
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
    enum: UserStatus,
    description: 'Set inactive to deactivate (immediate revoke).',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class SetUserRolesDto {
  @ApiProperty({
    type: [String],
    description: 'The complete set of role ids the user should hold.',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  role_ids!: string[];
}

/**
 * Admin-assisted password reset. The admin NEVER sees the password — they either email the user a reset
 * link or email them a forced-change temporary password. — AUTH-002 (security)
 */
export class AdminResetPasswordDto {
  @ApiProperty({
    enum: ['link', 'temp'],
    description: "'link' = email a reset link; 'temp' = email a temporary password that forces a change at next login.",
  })
  @IsIn(['link', 'temp'])
  mode!: 'link' | 'temp';
}
