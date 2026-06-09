import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

const PCT = /^[01](\.\d{1,4})?$/; // 0..1 with up to 4 decimals (Decimal(5,4)) — exact string, never float
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SetHoldbackConfigDto {
  @ApiProperty({ example: '0.7000', description: 'Advance fraction (0..1), decimal STRING.' })
  @Matches(PCT, { message: 'advance_pct must be a decimal string 0..1 with up to 4 decimals' })
  advance_pct!: string;

  @ApiProperty({
    example: '0.3000',
    description: 'Holdback fraction; advance_pct + holdback_pct must = 1.',
  })
  @Matches(PCT, { message: 'holdback_pct must be a decimal string 0..1 with up to 4 decimals' })
  holdback_pct!: string;

  @ApiProperty({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

/** Edit a PENDING split (the resulting advance_pct + holdback_pct must still equal 1). */
export class UpdateHoldbackConfigDto {
  @ApiPropertyOptional({ example: '0.7000', description: 'Advance fraction (0..1), decimal STRING.' })
  @IsOptional()
  @Matches(PCT, { message: 'advance_pct must be a decimal string 0..1 with up to 4 decimals' })
  advance_pct?: string;

  @ApiPropertyOptional({ example: '0.3000', description: 'Holdback fraction; the pair must sum to 1.' })
  @IsOptional()
  @Matches(PCT, { message: 'holdback_pct must be a decimal string 0..1 with up to 4 decimals' })
  holdback_pct?: string;

  @ApiPropertyOptional({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

/**
 * The CONFIRMED holdback-release rule (SRS §17.1) — the Super Admin sets it once, stickily, and the Pay
 * Run reads it at finalize to schedule each period's 30% into the correct future cycle. Stored as a
 * structured string: `cycles:N` (release in the Nth pay period after the origin) or `days:N` (release in
 * the first period whose payday ≥ origin payday + N days). A later change affects only FUTURE holds.
 */
export class SetHoldbackReleaseSettingDto {
  @ApiProperty({
    example: 'days:30',
    description: 'Sticky release rule: `cycles:N` (Nth period after origin) or `days:N` (first payday ≥ origin payday + N days).',
  })
  @Matches(/^(cycles|days):\d{1,3}$/, { message: 'release_rule must be `cycles:N` or `days:N` (N a small positive integer)' })
  @MinLength(1)
  @MaxLength(255)
  release_rule!: string;
}
