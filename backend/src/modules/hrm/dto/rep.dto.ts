import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

const DATE = /^\d{4}-\d{2}-\d{2}$/; // 'YYYY-MM-DD' date-only

export class CreateRepDto {
  @ApiProperty({
    example: 'Redwave07',
    description: 'Unique rep code. Never reused — even after termination.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  rep_code!: string;

  @ApiProperty({ example: 'Jordan Field' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  full_name!: string;

  @ApiProperty({ description: 'User id of the Field Manager (must hold the Manager role).' })
  @IsUUID()
  field_manager_id!: string;

  @ApiProperty({ example: '2026-01-15', description: 'YYYY-MM-DD.' })
  @Matches(DATE, { message: 'hire_date must be a YYYY-MM-DD date' })
  hire_date!: string;

  @ApiPropertyOptional({ description: 'Optional linked login user (source of contact info).' })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({ description: 'Sensitive banking / e-transfer details (role-gated).' })
  @IsOptional()
  @IsObject()
  payment_details?: Record<string, unknown>;
}

export class UpdateRepDto {
  // rep_code is intentionally NOT editable — it is the never-reused business key (#11).

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  full_name?: string;

  @ApiPropertyOptional({ description: 'Reassign the Field Manager (must hold the Manager role).' })
  @IsOptional()
  @IsUUID()
  field_manager_id?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @Matches(DATE, { message: 'hire_date must be a YYYY-MM-DD date' })
  hire_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  payment_details?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: RepStatus, description: 'terminated requires termination_date.' })
  @IsOptional()
  @IsEnum(RepStatus)
  status?: RepStatus;

  @ApiPropertyOptional({ example: '2026-06-30', description: 'Required when status=terminated.' })
  @IsOptional()
  @Matches(DATE, { message: 'termination_date must be a YYYY-MM-DD date' })
  termination_date?: string;
}

/** Paginated rep list (page/limit/sort/search from PaginationQuery). sort allowlist:
 *  rep_code/full_name/status/hire_date/created_at. search matches full_name + rep_code. */
export class ListRepsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['active', 'terminated', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'terminated', 'all'])
  status?: 'active' | 'terminated' | 'all';

  @ApiPropertyOptional({ description: 'Filter by field manager (user id).' })
  @IsOptional()
  @IsUUID()
  fieldManagerId?: string;
}
