/**
 * Sales response DTOs — the documented shapes the SalesController returns, so the OpenAPI contract
 * carries real response schemas (the frontend aliases these instead of hand-writing types). — Batch A #2
 *
 * MONEY DISCIPLINE (#1): every Decimal field is a decimal STRING, never a number — the snapshot money
 * fields (`rate_applied`, `commission_paid`, `incentive_amount`) are `string | null` (NULL until paid, #2).
 * Nullable/enum/nested fields carry an EXPLICIT `type`/`enum` so swagger reflection never degrades them
 * to `Record<string, never>` (the documented quirk). — CLAUDE §13
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleItemStatus, SaleStatus } from '@prisma/client';
import { PageMetaResponse } from '../../../common/pagination/page.response';

/** The 4-field pay period DERIVED onto a sale by list/findOne (sale_date → period). NOT the full Pay Run shape. */
export class SalePayPeriodResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 3 })
  period_number!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  start_date!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  end_date!: string;
}

/** The item's product, for display — the type key alone can't name a speed. */
export class SaleItemProductResponse {
  @ApiProperty({ example: 'Fibre 1gig/2.5gig' })
  name!: string;
}

export class SaleItemResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sale_id!: string;

  @ApiProperty()
  product_id!: string;

  @ApiProperty({ type: () => SaleItemProductResponse, description: 'The product this item sold (name only).' })
  product!: SaleItemProductResponse;

  @ApiProperty({ type: String, example: 'internet', description: 'Product-type catalogue key (snapshot).' })
  product_type!: string;

  @ApiProperty({ description: 'internet && !greenfield — the only items that count toward the tier tally.' })
  counts_toward_tally!: boolean;

  @ApiProperty({ enum: SaleItemStatus })
  item_status!: SaleItemStatus;

  // ── Frozen snapshot (set ONCE at pay-run finalize; non-null only on PAID items — #2). ──────────────
  @ApiProperty({ type: Number, nullable: true, description: 'Tier bracket at payment (internet only).' })
  tier_at_payment!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '145.00', description: 'Decimal string. Frozen rate.' })
  rate_applied!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '145.00',
    description: 'Decimal string. Non-null = PAID (the clawable signal). base + incentive.',
  })
  commission_paid!: string | null;

  @ApiProperty({ type: String, nullable: true })
  incentive_id!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '20.00', description: 'Decimal string. Frozen incentive.' })
  incentive_amount!: string | null;
}

export class SaleResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '2026-01-10-VF', description: 'Composite Sale ID (sale_date[-mpu]-client[-N]).' })
  sale_code!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'GOVERNS the pay period (#7).' })
  sale_date!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Reference only — drives no logic.' })
  activation_date!: string | null;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Given name (the client bill prints it separately).' })
  customer_first_name!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Family name.' })
  customer_last_name!: string | null;

  @ApiProperty()
  street!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  province_state!: string;

  @ApiProperty()
  postal_code!: string;

  @ApiProperty({ type: String, nullable: true })
  mpu_id!: string | null;

  @ApiProperty()
  is_greenfield!: boolean;

  @ApiProperty({ enum: SaleStatus })
  status!: SaleStatus;

  @ApiProperty({ type: String, nullable: true })
  validated_by!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validated_at!: string | null;

  @ApiProperty({ type: String, nullable: true })
  pay_run_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: () => [SaleItemResponse] })
  sale_items!: SaleItemResponse[];

  @ApiPropertyOptional({
    type: () => SalePayPeriodResponse,
    nullable: true,
    description: 'Derived from sale_date on list/findOne; absent on create/edit/validate responses.',
  })
  pay_period?: SalePayPeriodResponse | null;
}

export class BulkValidateItemResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  ok!: boolean;

  @ApiPropertyOptional({ type: String, description: 'Failure reason when ok=false.' })
  error?: string;
}

export class BulkValidateResultResponse {
  @ApiProperty({ example: 5 })
  validated!: number;

  @ApiProperty({ example: 1 })
  failed!: number;

  @ApiProperty({ type: () => [BulkValidateItemResponse] })
  results!: BulkValidateItemResponse[];
}

/** Soft-delete returns only the identifier + new status (the row is preserved). */
export class DeletedSaleResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SaleStatus, example: 'deleted' })
  status!: SaleStatus;
}

/** Paginated list envelope (arch §5.1) — one page of sales + the meta. */
export class SalePageResponse {
  @ApiProperty({ type: () => [SaleResponse] })
  data!: SaleResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}
