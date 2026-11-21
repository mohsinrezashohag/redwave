import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { REGION_CODES } from '../../../common/geo/regions';
import { REGION_MESSAGE, SaleItemInput, upperTrim } from './create-sale.dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Edit a sale inside its 5-day window (client meeting 2026-11-16). The identity fields that compose the Sale
 * ID (client_id, sale_date, mpu_id) and the rep stay immutable: delete and re-enter to correct those. The
 * same body is used for a rep's EDIT REQUEST (`POST /v1/sales/:id/edit-requests`). Products are re-checked
 * with the entry rules (they belong to the client, SALE-001a internet base). — SRS SALE-001
 */
export class UpdateSaleDto {
  @ApiPropertyOptional({ description: 'Derived from the first/last pair when those are supplied.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  customer_name?: string;

  @ApiPropertyOptional({ example: 'Liam' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  customer_first_name?: string;

  @ApiPropertyOptional({ example: 'Tremblay' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  customer_last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  street?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'MB', description: 'Province/territory or US state CODE.' })
  @IsOptional()
  @Transform(upperTrim)
  @IsIn(REGION_CODES, { message: REGION_MESSAGE })
  province_state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postal_code?: string;

  @ApiPropertyOptional({
    example: '2026-01-15',
    description: 'YYYY-MM-DD. Reference only. An empty string clears it.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== '')
  @Matches(DATE, { message: 'activation_date must be a YYYY-MM-DD date' })
  activation_date?: string;

  @ApiPropertyOptional({ description: 'The greenfield flag (recomputes counts_toward_tally on the internet item).' })
  @IsOptional()
  @IsBoolean()
  is_greenfield?: boolean;

  @ApiPropertyOptional({
    type: [SaleItemInput],
    description: 'The full new product list (replaces the current one). Same rules as entry.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInput)
  items?: SaleItemInput[];
}

/** Reject an edit request, with an optional note for the rep. */
export class RejectSaleEditRequestDto {
  @ApiPropertyOptional({ description: 'Why the edit was rejected (shown to the rep).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Approve an edit request, with an optional note. */
export class ApproveSaleEditRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
