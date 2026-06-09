/**
 * Product-type catalogue DTOs. A new type is always a standard add-on (billable, flat-rated, NOT tiered,
 * NOT greenfield) — behaviour is forced server-side, never client-supplied, so a new type can never change
 * tally/greenfield logic (#5/#9). Create may carry an INLINE commission flat rate (Q2) — written to the
 * commission stream in the same transaction (#3: catalogue carries no rate).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Optional initial COMMISSION flat rate for a new type (what we pay the rep). — #3 commission stream */
export class InitialFlatRateDto {
  @ApiProperty({ example: '30.00', description: 'Exact decimal STRING — never a float.' })
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount!: string;

  @ApiProperty({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;
}

export class CreateProductTypeDto {
  @ApiProperty({ example: 'satellite', description: 'Immutable lowercase snake_case key.' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'key must be lowercase snake_case (start with a letter)' })
  @MaxLength(40)
  key!: string;

  @ApiProperty({ example: 'Satellite Internet' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiPropertyOptional({ type: InitialFlatRateDto, description: 'Optional inline commission flat rate.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialFlatRateDto)
  initial_flat_rate?: InitialFlatRateDto;
}

export class UpdateProductTypeDto {
  @ApiPropertyOptional({ example: 'Satellite' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @ApiPropertyOptional({ description: 'Set false to deactivate (system types cannot be deactivated).' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ListProductTypesQuery {
  @ApiPropertyOptional({ enum: ['active', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['active', 'all'])
  status?: 'active' | 'all';
}
