import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RateKind } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/; // exact decimal STRING, max 2 dp — never a JS float (#1)
const DATE = /^\d{4}-\d{2}-\d{2}$/; // 'YYYY-MM-DD' date-only

export class CreateBillingRateDto {
  @ApiPropertyOptional({ description: 'Product the rate applies to. Omit for add-on rate kinds.' })
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @ApiProperty({ enum: RateKind })
  @IsEnum(RateKind)
  rate_kind!: RateKind;

  @ApiProperty({ example: '49.99', description: 'Exact decimal STRING (≤2 dp). Never a float.' })
  @IsString()
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount!: string;

  @ApiProperty({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'YYYY-MM-DD; null = open-ended.' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

/** Edit a PENDING rate (amount / effective window). rate_kind + product_id (the scope) are immutable. */
export class UpdateBillingRateDto {
  @ApiPropertyOptional({ example: '49.99', description: 'Exact decimal STRING (≤2 dp).' })
  @IsOptional()
  @IsString()
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount?: string;

  @ApiPropertyOptional({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'YYYY-MM-DD; null/omit = open-ended.' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

export class ListBillingRatesQuery {
  @ApiPropertyOptional({ description: 'Return the single rate in force per scope on this date.' })
  @IsOptional()
  @Matches(DATE, { message: 'effectiveOn must be a YYYY-MM-DD date' })
  effectiveOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: RateKind })
  @IsOptional()
  @IsEnum(RateKind)
  rateKind?: RateKind;

  @ApiPropertyOptional({ enum: ['past', 'current', 'pending', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['past', 'current', 'pending', 'all'])
  status?: 'past' | 'current' | 'pending' | 'all';
}
