import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepStatus } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
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

  @ApiPropertyOptional({
    example: 'Redwave20',
    description:
      'Optional legacy / partner code for this rep, as it appears in spreadsheets and partner reports. ' +
      'Imports resolve a rep by EITHER this or rep_code. Unlike rep_code it is editable, and it is not a ' +
      'business key — it exists so an existing file need not be rewritten.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  external_code?: string;

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
  // external_code IS editable: it is only an alias used to resolve imports.

  @ApiPropertyOptional({ example: 'Redwave20', description: 'Legacy / partner code used to resolve imports.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  external_code?: string;

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

  @ApiPropertyOptional({ description: 'Filter by field manager (user id) — the manager-team view.' })
  @IsOptional()
  @IsUUID()
  fieldManagerId?: string;
}

/** Reassign one or more reps to a field manager (bulk). — HRM team management */
export class BulkAssignManagerDto {
  @ApiProperty({ type: [String], description: 'Rep ids to (re)assign.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  rep_ids!: string[];

  @ApiProperty({ description: 'The field-manager user id (must be an active user holding the Manager role).' })
  @IsUUID()
  field_manager_id!: string;
}
