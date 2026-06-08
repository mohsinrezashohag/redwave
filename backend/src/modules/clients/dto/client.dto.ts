import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Market } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

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

  @ApiProperty({ description: 'Whether the partner supplies per-house MPU IDs.' })
  @IsBoolean()
  supplies_mpu_id!: boolean;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supplies_mpu_id?: boolean;

  @ApiPropertyOptional({ description: 'Set false to deactivate (soft — history preserved).' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/** Paginated list filter (default: active only). sort allowlist: client_code/name/market/is_active/created_at. */
export class ListClientsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}
