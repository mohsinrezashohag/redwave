/**
 * Per-product REP tier rates — what a given bracket pays for ONE product.
 *
 * This never touches the tally or the bracket boundaries: the one cross-client internet count still picks
 * the tier for every product alike (#5). It answers only "given that tier, what does this product pay?",
 * exactly as the existing per-client scoping resolves a rate and never the tally.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTierRateDto {
  @ApiPropertyOptional({
    description:
      'Client this rate applies to. OMIT for the rate that applies to every client for this product ' +
      "(the per-product fallback). A client's rate wins over it.",
  })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiProperty({ description: 'The product this rate prices. Must be a TIERED product type.' })
  @IsUUID()
  product_id!: string;

  @ApiProperty({
    type: Number,
    example: 2,
    description: 'Which bracket this rate is for — matches the tier schedule (1 = highest).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tier_number!: number;

  @ApiProperty({ example: '145.00', description: 'Exact decimal STRING — never a float.' })
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount!: string;

  @ApiProperty({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

/** Edit a PENDING tier rate (amount / window). The SCOPE (client, product, tier) is immutable. — #10 */
export class UpdateTierRateDto {
  @ApiPropertyOptional({ example: '150.00' })
  @IsOptional()
  @IsString()
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'null/omit = open-ended.' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

export class ListTierRatesQuery {
  @ApiPropertyOptional({ enum: ['past', 'current', 'pending', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['past', 'current', 'pending', 'all'])
  status?: 'past' | 'current' | 'pending' | 'all';

  @ApiPropertyOptional({
    description: "Scope filter: a client id, the literal 'global', or omit for every scope.",
  })
  @IsOptional()
  @IsString()
  client_id?: string;

  @ApiPropertyOptional({ description: 'Only rates for this product.' })
  @IsOptional()
  @IsUUID()
  product_id?: string;
}
