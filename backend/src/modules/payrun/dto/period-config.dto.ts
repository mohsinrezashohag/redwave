/**
 * Period-config DTOs — the pay and billing calendars as admin configuration.
 *
 * Two calendars, never substituted for one another (§14 rule 1): `pay` governs rep pay and carries a
 * payday offset; `billing` governs client billing and has none, because a bill is what the client owes,
 * not what a rep is paid. The service rejects a payday offset on a billing calendar rather than ignoring
 * it — silently dropping a field an admin deliberately filled in is how config drifts from intent.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SetPeriodConfigDto {
  @ApiProperty({ enum: ['pay', 'billing'], description: 'Which calendar this configures.' })
  @IsIn(['pay', 'billing'])
  kind!: 'pay' | 'billing';

  @ApiProperty({ example: '2026-01-04', description: "The first period's start date (YYYY-MM-DD)." })
  @Matches(DATE, { message: 'anchor_date must be a YYYY-MM-DD date' })
  anchor_date!: string;

  @ApiProperty({
    type: Number,
    example: 14,
    description: 'Period length in days — 14 for the biweekly pay cycle, 7 for the weekly billing week.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  length_days!: number;

  @ApiPropertyOptional({
    type: Number,
    example: 13,
    description:
      'Days after a period CLOSES that reps are paid. Pay calendars only — a billing week has no payday, ' +
      'and supplying one there is a 422. Zero means paid on close.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  payday_offset_days?: number;

  @ApiProperty({
    example: '2026-10-01',
    description: 'When this shape takes effect. Recording it changes nothing on its own — periods move only when an admin regenerates.',
  })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;
}

export class RegeneratePeriodsDto {
  @ApiProperty({ enum: ['pay', 'billing'] })
  @IsIn(['pay', 'billing'])
  kind!: 'pay' | 'billing';

  @ApiProperty({
    type: Number,
    example: 26,
    description: 'How many periods forward to generate, starting from the one containing today.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count!: number;
}
