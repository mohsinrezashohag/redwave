/**
 * Period-config response DTOs — the calendars as admin configuration.
 *
 * `RegenerationPlanResponse.blocked[]` is the important one: it is not an error list but the FORWARD-ONLY
 * guard made legible. Each entry names the period AND the document that froze it, because "period 18 is
 * blocked" sends an admin hunting while "period 18 has finalized pay run …" does not.
 */
import { ApiProperty } from '@nestjs/swagger';

export class PeriodConfigResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['pay', 'billing'] })
  kind!: 'pay' | 'billing';

  @ApiProperty({ type: String, example: '2026-01-04', description: "The first period's start date." })
  anchor_date!: string;

  @ApiProperty({ type: Number, example: 14 })
  length_days!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 13,
    description: 'Days after close that reps are paid. Null for a billing calendar — a bill has no payday.',
  })
  payday_offset_days!: number | null;

  @ApiProperty({ type: String, example: '2026-10-01' })
  effective_from!: string;

  @ApiProperty({ type: String, nullable: true })
  effective_to!: string | null;

  @ApiProperty()
  created_by!: string;
}

export class GeneratedPeriodResponse {
  @ApiProperty({ type: Number })
  period_number!: number;

  @ApiProperty({ type: String, example: '2026-09-06' })
  start_date!: string;

  @ApiProperty({ type: String, example: '2026-09-19' })
  end_date!: string;

  @ApiProperty({ type: String, required: false, description: 'Pay calendars only.' })
  payday?: string;
}

/** One period regeneration refused to touch, and the document that froze it. */
export class BlockedPeriodResponse {
  @ApiProperty({ type: Number })
  period_number!: number;

  @ApiProperty({ type: String })
  start_date!: string;

  @ApiProperty({ type: String })
  end_date!: string;

  @ApiProperty({
    example: 'pay run 3f2a… is finalized for this period',
    description: 'Names the blocking document so an admin does not have to hunt for it.',
  })
  reason!: string;
}

export class PeriodShapeResponse {
  @ApiProperty({ type: String })
  anchor_date!: string;

  @ApiProperty({ type: Number })
  length_days!: number;

  @ApiProperty({ type: Number, nullable: true })
  payday_offset_days!: number | null;
}

export class RegenerationPlanResponse {
  @ApiProperty({ enum: ['pay', 'billing'] })
  kind!: 'pay' | 'billing';

  @ApiProperty({ type: () => PeriodShapeResponse })
  shape!: PeriodShapeResponse;

  @ApiProperty({ type: Number, description: 'The first period touched — the one containing today.' })
  from_period!: number;

  @ApiProperty({ type: [GeneratedPeriodResponse] })
  periods!: GeneratedPeriodResponse[];

  @ApiProperty({
    type: [BlockedPeriodResponse],
    description: 'Frozen periods. If ANY are present, an apply refuses entirely — a partial move is worse.',
  })
  blocked!: BlockedPeriodResponse[];

  @ApiProperty({ required: false, description: 'True only on an apply that actually wrote.' })
  applied?: boolean;
}

export class OverlappingBillingPeriodResponse {
  @ApiProperty({ type: Number })
  billing_period_number!: number;

  @ApiProperty({ type: String })
  start_date!: string;

  @ApiProperty({ type: String })
  end_date!: string;

  @ApiProperty({ description: 'False when the week crosses the pay-period boundary — the expected case.' })
  fully_inside!: boolean;
}

export class CalendarOverlapResponse {
  @ApiProperty({ type: Number })
  pay_period_number!: number;

  @ApiProperty({ type: String })
  pay_start!: string;

  @ApiProperty({ type: String })
  pay_end!: string;

  @ApiProperty({ type: [OverlappingBillingPeriodResponse] })
  billing_periods!: OverlappingBillingPeriodResponse[];
}
