import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateFlatRateDto {
  @ApiPropertyOptional({
    description:
      'Client this rate applies to. OMIT for the GLOBAL rate — the fallback for any client without its own.',
  })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiProperty({
    type: String,
    example: 'tv',
    description: 'Product-type catalogue key. A tiered type (e.g. internet) is rejected (422).',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'product_type must be a lowercase snake_case catalogue key' })
  product_type!: string;

  @ApiProperty({ example: '30.00', description: 'Exact decimal STRING — never a float.' })
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

/** Edit a PENDING flat rate (amount / effective window). product_type (the scope) is immutable. */
export class UpdateFlatRateDto {
  @ApiPropertyOptional({ example: '35.00', description: 'Exact decimal STRING (≤2 dp).' })
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

export class ListFlatRatesQuery {
  @ApiPropertyOptional({ enum: ['past', 'current', 'pending', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['past', 'current', 'pending', 'all'])
  status?: 'past' | 'current' | 'pending' | 'all';

  @ApiPropertyOptional({
    description:
      "Scope filter: a client id, the literal 'global' for the global fallback, or omit for every scope.",
    example: 'global',
  })
  @IsOptional()
  @IsString()
  client_id?: string;
}
