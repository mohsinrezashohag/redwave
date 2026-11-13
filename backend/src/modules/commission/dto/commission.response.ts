/**
 * Commission Config response DTOs — the REP-commission stream (SEPARATE from client billing rates, #3).
 * This module only STORES config; the engine reads it at runtime. No tiers since 2026-11-13. — Batch A #2
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

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'ONE product this rate prices; null = the rate for the whole product TYPE (the fallback). A product ' +
      'rate wins over its type rate.',
  })
  product_id!: string | null;

  @ApiProperty({ type: String, example: '100.00', description: 'Decimal string — the rep rate.' })
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
