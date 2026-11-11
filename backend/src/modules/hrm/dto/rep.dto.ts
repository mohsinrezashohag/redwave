import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepStatus } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQuery } from '../../../common/pagination/pagination.query';
import { CLOTHING_SIZES, PROVINCES } from '../rep-profile.logic';

const DATE = /^\d{4}-\d{2}-\d{2}$/; // 'YYYY-MM-DD' date-only

/**
 * The rep PROFILE fields (client request 2026-11-11), shared by create and update. All optional; on update,
 * `null` clears a field. Formats are checked here; the SIN's Luhn checksum, the postal code's shape and
 * "DOB not in the future" are checked in the service, so one rule set serves both DTOs.
 * DOB / contact / address / SIN are PII — redacted unless hrm:edit (HRM-008).
 */
/** Canadian direct-deposit details. Formats are checked in the service (rep-profile.logic). */
export class RepBankingDto {
  @ApiProperty({ example: '001', description: 'Institution number (3 digits).' })
  @IsString()
  @MaxLength(10)
  institution_no!: string;

  @ApiProperty({ example: '12345', description: 'Transit (branch) number (5 digits).' })
  @IsString()
  @MaxLength(10)
  transit_no!: string;

  @ApiPropertyOptional({
    example: '1234567',
    description: 'Account number (7–12 digits). WRITE-ONLY; blank on edit keeps the one on file.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_no?: string;
}

export class RepProfileFieldsDto {
  @ApiPropertyOptional({ example: '1994-03-21', nullable: true, description: 'YYYY-MM-DD. PII (hrm:edit).' })
  @IsOptional()
  @Matches(DATE, { message: 'date_of_birth must be a YYYY-MM-DD date' })
  date_of_birth?: string | null;

  @ApiPropertyOptional({ example: '+1 204 555 0142', nullable: true, description: 'PII (hrm:edit).' })
  @IsOptional()
  @Matches(/^[+\d\s().-]{7,30}$/, { message: 'phone must be a phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'jordan@example.com', nullable: true, description: 'PII (hrm:edit).' })
  @IsOptional()
  @IsEmail({}, { message: 'email must be an email address' })
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({ example: '1250 Portage Ave', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_street?: string | null;

  @ApiPropertyOptional({ example: 'Winnipeg', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_city?: string | null;

  @ApiPropertyOptional({ enum: PROVINCES, nullable: true })
  @IsOptional()
  @IsIn([...PROVINCES])
  address_province?: string | null;

  @ApiPropertyOptional({ example: 'R3G 0T7', nullable: true, description: 'Canadian postal code.' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  address_postal?: string | null;

  @ApiPropertyOptional({
    example: '046 454 286',
    nullable: true,
    description:
      'Social Insurance Number — WRITE-ONLY. Stored encrypted; responses carry only `sin_masked`. ' +
      'Spaces/dashes allowed; must pass the Luhn check. Empty string or null clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  sin?: string | null;

  @ApiPropertyOptional({ enum: CLOTHING_SIZES, nullable: true })
  @IsOptional()
  @IsIn([...CLOTHING_SIZES])
  jacket_size?: string | null;

  @ApiPropertyOptional({ enum: CLOTHING_SIZES, nullable: true })
  @IsOptional()
  @IsIn([...CLOTHING_SIZES])
  tshirt_size?: string | null;

  @ApiPropertyOptional({
    type: () => RepBankingDto,
    nullable: true,
    description:
      'Direct-deposit banking (2026-11-12). PII — hrm:edit. The ACCOUNT number is write-only and stored encrypted; ' +
      'leave it blank on edit to keep the one on file. null clears banking.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RepBankingDto)
  banking?: RepBankingDto | null;
}

export class CreateRepDto extends RepProfileFieldsDto {
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

export class UpdateRepDto extends RepProfileFieldsDto {
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
