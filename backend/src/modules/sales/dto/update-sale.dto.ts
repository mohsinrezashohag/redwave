import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Edit an ENTERED sale. Identity fields that compose the Sale ID — client_id, sale_date, mpu_id —
 * are intentionally immutable (delete + re-enter to correct them). Greenfield is set via its own
 * endpoint. — SRS SALE-001 (edit pre-validation)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province_state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postal_code?: string;

  @ApiPropertyOptional({ example: '2026-01-15', description: 'YYYY-MM-DD. Reference only.' })
  @IsOptional()
  @Matches(DATE, { message: 'activation_date must be a YYYY-MM-DD date' })
  activation_date?: string;
}
