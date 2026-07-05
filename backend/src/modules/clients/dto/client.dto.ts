import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Market } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

/** An SA-defined custom name/value pair on a client. Replace-in-place (the whole set is sent each save). */
export class ClientCustomFieldInput {
  @ApiProperty({ example: 'Account manager' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  field_name!: string;

  @ApiProperty({ example: 'Jane Smith' })
  @IsString()
  @MaxLength(500)
  field_value!: string;
}

export class CreateClientDto {
  @ApiProperty({ example: 'VF', description: 'Unique client code (e.g. VF / RF / CTI).' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  client_code!: string;

  @ApiProperty({ example: 'Valley Fiber' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: Market })
  @IsEnum(Market)
  market!: Market;

  @ApiPropertyOptional({
    example: 'CAD',
    description: 'Billing currency (ISO 4217; default CAD). All of this client’s billing rates + documents are in it; rolls up to CAD via frozen FX (#12).',
  })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency?: string;

  @ApiProperty({ description: 'Whether the partner supplies per-house MPU IDs.' })
  @IsBoolean()
  supplies_mpu_id!: boolean;

  @ApiPropertyOptional({ type: ClientCustomFieldInput, isArray: true, description: 'Custom name/value pairs.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClientCustomFieldInput)
  custom_fields?: ClientCustomFieldInput[];
}

export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  client_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ enum: Market })
  @IsOptional()
  @IsEnum(Market)
  market?: Market;

  @ApiPropertyOptional({
    example: 'USD',
    description: 'Billing currency (ISO 4217). Editable only while the client has no ISSUED statement/invoice (then locked to keep frozen billing history coherent, #12).',
  })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supplies_mpu_id?: boolean;

  @ApiPropertyOptional({ description: 'Set false to deactivate (soft — history preserved).' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({
    type: ClientCustomFieldInput,
    isArray: true,
    description: 'Replaces the full custom-field set when provided (omit to leave unchanged).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClientCustomFieldInput)
  custom_fields?: ClientCustomFieldInput[];
}

/** Paginated list filter (default: active only). sort allowlist: client_code/name/market/is_active/created_at. */
export class ListClientsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}
