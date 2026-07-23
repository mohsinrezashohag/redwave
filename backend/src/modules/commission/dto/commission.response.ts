/**
 * Commission Config response DTOs — the REP-commission stream (SEPARATE from client billing rates, #3).
 * This module only STORES config; the engine determines tiers at runtime (#5). — Batch A #2
 *
 * MONEY/RATE DISCIPLINE (#1): `rate_per_activation`, flat `amount`, incentive `amount` are decimal
 * STRINGS. `advance_pct`/`holdback_pct` are NON-money Decimal(5,4) — still STRINGS, never numbers. The
 * effective-dated configs carry a server-derived `status` (current|pending|past).
 */
import { ApiProperty } from '@nestjs/swagger';
import { IncentiveStatus, IncentiveTargetType } from '@prisma/client';

/** The status the server derives for an effective-dated row (mirrors the FE `RateStatus`). */
const RATE_STATUS = ['current', 'pending', 'past'] as const;
type RateStatus = (typeof RATE_STATUS)[number];

export class TierBracketResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tier_config_id!: string;

  @ApiProperty({ example: 4, description: '1 = highest .. 4 = entry.' })
  tier_number!: number;

  @ApiProperty({ example: 0 })
  min_count!: number;

  @ApiProperty({ type: Number, nullable: true, example: 6, description: 'null = open-ended (36+).' })
  max_count!: number | null;

  @ApiProperty({ type: String, example: '110.00', description: 'Decimal string — the per-activation rate.' })
  rate_per_activation!: string;
}

export class TierConfigResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Client this schedule applies to; null = the GLOBAL ladder (fallback for clients without their own).",
  })
  client_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  effective_from!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effective_to!: string | null;

  @ApiProperty()
  created_by!: string;

  @ApiProperty({ enum: RATE_STATUS })
  status!: RateStatus;

  @ApiProperty({ type: () => [TierBracketResponse] })
  tiers!: TierBracketResponse[];
}

export class FlatRateResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Client this rate applies to; null = the GLOBAL rate for this product type.',
  })
  client_id!: string | null;

  @ApiProperty({ type: String, example: 'tv', description: 'Product-type catalogue key.' })
  product_type!: string;

  @ApiProperty({ type: String, example: '100.00', description: 'Decimal string — the flat rate.' })
  amount!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  effective_from!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effective_to!: string | null;

  @ApiProperty()
  created_by!: string;

  @ApiProperty({ enum: RATE_STATUS })
  status!: RateStatus;
}

export class HoldbackConfigResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, example: '0.7000', description: 'Decimal STRING (5,4) — NOT money, but never a number.' })
  advance_pct!: string;

  @ApiProperty({ type: String, example: '0.3000', description: 'Decimal STRING (5,4).' })
  holdback_pct!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  effective_from!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effective_to!: string | null;

  @ApiProperty({ enum: RATE_STATUS })
  status!: RateStatus;
}

/** PROPOSED (SRS §17): the sticky release setting (latest wins). Stored only — Pay Run interprets it. */
export class HoldbackReleaseSettingResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'next_cycle_after_30_days' })
  release_rule!: string;

  @ApiProperty()
  set_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  effective_from!: string;
}

export class IncentiveResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true, description: 'null = all clients.' })
  scope_client_id!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Catalogue key; null = all product types.' })
  scope_product_type!: string | null;

  @ApiProperty({ enum: IncentiveTargetType })
  target_type!: IncentiveTargetType;

  @ApiProperty({ type: Number, nullable: true, description: 'The threshold: per_activation pays beyond it; one_time reaches it (required for one_time).' })
  target_count!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  window_start!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  window_end!: string;

  @ApiProperty({ type: String, example: '20.00', description: 'Decimal string — the spiff amount.' })
  amount!: string;

  @ApiProperty({ enum: IncentiveStatus })
  status!: IncentiveStatus;

  @ApiProperty()
  created_by!: string;
}
