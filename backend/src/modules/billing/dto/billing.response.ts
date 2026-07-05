/**
 * Billing response DTOs — the CLIENT-FACING billing stream the controllers return. — Batch A #2
 *
 * #3: these shapes carry NO commission/engine data — a statement is priced SOLELY from
 * client_billing_rates; the invoice `total_commission` IS the billing-stream statement total (never the
 * rep payout). Money is a decimal STRING (#1). No GST anywhere. One line per customer.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One line per customer/household (the backend aggregates a sale's products into one line). */
export class ClientStatementLineResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  statement_id!: string;

  @ApiProperty()
  sale_id!: string;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ example: 'Internet, TV, Home Phone' })
  products_summary!: string;

  @ApiProperty({ type: String, example: '90.00', description: 'Decimal string. Server-priced line total (CAD).' })
  line_total!: string;
}

export class ClientStatementResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true, example: 1, description: 'Gapless sequential number (STMT-00001), minted on issue.' })
  statement_number!: number | null;

  @ApiProperty({ enum: ['issued', 'superseded'], description: 'issued = current; superseded = an earlier version (immutable).' })
  status!: 'issued' | 'superseded';

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string. Server-computed statement total in `currency`, no GST.' })
  total_amount!: string;

  @ApiProperty({ type: String, example: 'CAD', description: 'Billing currency (the client’s currency at issue).' })
  currency!: string;

  @ApiProperty({ type: String, example: '1.00000000', description: 'Frozen currency→CAD rate (8 dp); 1 for CAD; never re-converted (#12).' })
  fx_rate!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The frozen rate’s day (audit).' })
  fx_rate_date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '140.00', description: 'Frozen CAD value (= total_amount × fx_rate); reconciliation reads THIS.' })
  amount_cad!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Storage object path of a rendered artifact (or null — rendered on demand).' })
  file_url!: string | null;

  @ApiProperty()
  generated_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The newer version that superseded this one (null if current).' })
  superseded_by_id!: string | null;

  @ApiPropertyOptional({
    type: () => [ClientStatementLineResponse],
    description: 'Present on generate/detail; absent on the list.',
  })
  lines?: ClientStatementLineResponse[];
}

export class ClientInvoiceResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true, example: 1, description: 'Gapless sequential number (INV-00001), minted on issue.' })
  invoice_number!: number | null;

  @ApiProperty({ enum: ['issued', 'superseded'] })
  status!: 'issued' | 'superseded';

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string = the billing-stream statement total in `currency` (#3).' })
  total_commission!: string;

  @ApiProperty({ type: String, example: 'CAD', description: 'Billing currency (the client’s currency at issue).' })
  currency!: string;

  @ApiProperty({ type: String, example: '1.00000000', description: 'Frozen currency→CAD rate (8 dp); 1 for CAD; never re-converted (#12).' })
  fx_rate!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The frozen rate’s day (audit).' })
  fx_rate_date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '140.00', description: 'Frozen CAD value (= total_commission × fx_rate).' })
  amount_cad!: string | null;

  @ApiProperty({ type: String, nullable: true })
  file_url!: string | null;

  @ApiProperty({ type: String, nullable: true })
  generated_by!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;

  @ApiProperty({ type: String, nullable: true })
  superseded_by_id!: string | null;
}

/** A statement PREVIEW — the one-line-per-customer draft, NOT persisted (no number is minted). */
export class StatementPreviewLineResponse {
  @ApiProperty()
  sale_id!: string;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ example: 'Internet, TV, Home Phone' })
  products_summary!: string;

  @ApiProperty({ type: String, example: '90.00', description: 'Decimal string (CAD).' })
  line_total!: string;
}

export class StatementPreviewResponse {
  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: () => [StatementPreviewLineResponse], description: 'One line per customer (combined product total, no GST).' })
  lines!: StatementPreviewLineResponse[];

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string. Draft total (CAD).' })
  total_amount!: string;
}

/** The export action's response — the rendered file is recorded (file_path) + downloadable. */
export class BillingExportResultResponse {
  @ApiPropertyOptional({ type: String, description: 'Set when exporting a statement.' })
  statement_id?: string;

  @ApiPropertyOptional({ type: String, description: 'Set when exporting an invoice.' })
  invoice_id?: string;

  @ApiProperty({ enum: ['excel', 'pdf', 'quickbooks'] })
  format!: 'excel' | 'pdf' | 'quickbooks';

  @ApiProperty({ type: String, nullable: true, description: 'Storage object path (null when storage is unconfigured — the file still downloads on demand).' })
  file_path!: string | null;
}
