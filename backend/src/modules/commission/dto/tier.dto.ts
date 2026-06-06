import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TierBracketDto {
  @ApiProperty({ example: 4, description: '1 = highest .. 4 = entry.' })
  @IsInt()
  @Min(1)
  tier_number!: number;

  @ApiProperty({ example: 0, description: 'Inclusive lower bound of the gross internet tally.' })
  @IsInt()
  @Min(0)
  min_count!: number;

  // Explicit type + nullable so swagger does NOT degrade the `number | null` union to `Record<string,never>`
  // (the documented quirk) — lets the frontend use the generated request DTO directly. — Batch A #2
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 6,
    description: 'Inclusive upper bound; null = open-ended (36+).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_count?: number | null;

  @ApiProperty({ example: '110.00', description: 'Exact decimal STRING — never a float.' })
  @Matches(MONEY, { message: 'rate_per_activation must be a decimal string with up to 2 decimals' })
  rate_per_activation!: string;
}

export class CreateTierScheduleDto {
  @ApiProperty({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'YYYY-MM-DD; null = open-ended.' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;

  @ApiProperty({
    type: [TierBracketDto],
    description: 'The full tier schedule (contiguous, one open top bracket).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TierBracketDto)
  tiers!: TierBracketDto[];
}
