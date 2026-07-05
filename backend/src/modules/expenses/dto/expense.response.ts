/**
 * Expenses response DTOs — item-first: each ITEM carries its own lifecycle (submitter/status/approver/
 * pay_period) + (optional) km log → stops. — Batch A #2 / Config batch (item-first)
 *
 * MONEY/Decimal → STRING (#1): item `amount`; km `total_km/deduction_km/billable_km/rate_per_km/
 * computed_amount`; stop `lat/lng`. `km_log` is present only on km items (else null); `receipt_url`/
 * `client_id`/`rep_id`/`pay_period_id`/`expense_report_id` nullable. `scope_filters` (export) is a
 * free-form JSON blob → `additionalProperties:true`.
 */
import { ApiProperty } from '@nestjs/swagger';
import { ExpenseCategory, ExpenseReportStatus, ExportFormat, TripType } from '@prisma/client';
import { PageMetaResponse } from '../../../common/pagination/page.response';

export class KmStopResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  km_log_id!: string;

  @ApiProperty({ example: 1 })
  stop_order!: number;

  @ApiProperty()
  address!: string;

  @ApiProperty({ type: String, example: '49.895100', description: 'Decimal string (signed lat).' })
  lat!: string;

  @ApiProperty({ type: String, example: '-97.138400', description: 'Decimal string (signed lng).' })
  lng!: string;
}

export class KmLogResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  expense_item_id!: string;

  @ApiProperty({ enum: TripType })
  trip_type!: TripType;

  @ApiProperty({ type: String, example: '130.00', description: 'Decimal string.' })
  total_km!: string;

  @ApiProperty({ type: String, example: '60.00', description: 'Decimal string — the deduction.' })
  deduction_km!: string;

  @ApiProperty({ type: String, example: '70.00', description: 'Decimal string — billable (floored at 0).' })
  billable_km!: string;

  @ApiProperty({ type: String, example: '0.450', description: 'Decimal string — rate $/km.' })
  rate_per_km!: string;

  @ApiProperty({ type: String, example: '31.50', description: 'Decimal string — server-computed amount.' })
  computed_amount!: string;

  @ApiProperty({ type: () => [KmStopResponse] })
  stops!: KmStopResponse[];
}

export class ExpenseItemResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Optional report grouping (item-first → usually null).' })
  expense_report_id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rep_id!: string | null;

  @ApiProperty({ description: 'The user who submitted this item.' })
  submitted_by!: string;

  @ApiProperty({ enum: ExpenseCategory })
  category!: ExpenseCategory;

  @ApiProperty({ type: String, nullable: true })
  client_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expense_date!: string;

  @ApiProperty({ type: String, example: '45.00', description: 'Decimal string in `original_currency`. For km, the server computes it (CAD).' })
  amount!: string;

  @ApiProperty({ type: String, example: 'CAD', description: 'Currency of `amount` (ISO 4217).' })
  original_currency!: string;

  @ApiProperty({ type: String, nullable: true, example: '1.00000000', description: 'Frozen original→CAD rate (8 dp); null until an approved foreign item is converted; 1 for CAD.' })
  fx_rate!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The frozen rate’s day (audit).' })
  fx_rate_date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '45.00', description: 'Frozen CAD value (= amount × fx_rate); the pay run reads THIS (#12).' })
  amount_cad!: string | null;

  @ApiProperty({ description: 'Personal / do-not-reimburse — excluded from reimbursable total + pay run + client output (EXP-012).' })
  is_personal!: boolean;

  @ApiProperty({ type: [String], nullable: true, description: 'Custom free-form tags (client + channel, EXP-002a). Null on legacy rows.' })
  tags!: string[] | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Required except for km items.' })
  receipt_url!: string | null;

  @ApiProperty({ enum: ExpenseReportStatus, description: 'Item lifecycle (submitted/approved/rejected/sent_back).' })
  status!: ExpenseReportStatus;

  @ApiProperty({ type: String, nullable: true })
  approved_by!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  approved_at!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Derived from expense_date — governs the payout cycle (EXP-009).' })
  pay_period_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: () => KmLogResponse, nullable: true, description: 'Present only on km items.' })
  km_log!: KmLogResponse | null;
}

/** Paginated list envelope (arch §5.1) — one page of expense items + the meta. */
export class ExpenseItemPageResponse {
  @ApiProperty({ type: () => [ExpenseItemResponse] })
  data!: ExpenseItemResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

/** Result of a bulk review — how many items actually transitioned vs were skipped (non-pending). */
export class BulkReviewResultResponse {
  @ApiProperty({ example: 5, description: 'Items that transitioned to the decided status.' })
  reviewed!: number;

  @ApiProperty({ example: 1, description: 'Items skipped (not in a reviewable status, or out of scope).' })
  skipped!: number;
}

/** An access-controlled receipt URL — a fresh 60s signed URL minted per access (never stored on the row). */
export class ReceiptUrlResponse {
  @ApiProperty({ description: 'Short-TTL (60s) signed URL for the item’s receipt.' })
  url!: string;
}

export class FieldConfigResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'meals' })
  category_key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  requires_receipt!: boolean;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty()
  created_by!: string;
}

export class ExpenseExportResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  generated_by!: string;

  @ApiProperty({ type: String, nullable: true })
  client_id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  pay_period_id!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The filters used to scope the export.' })
  scope_filters!: Record<string, unknown>;

  @ApiProperty({ enum: ExportFormat })
  format!: ExportFormat;

  @ApiProperty()
  file_url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;
}
