/**
 * Billing response DTOs — the CLIENT-FACING billing stream the controllers return. — Batch A #2
 *
 * #3: these shapes carry NO commission/engine data — a statement is priced SOLELY from
 * client_billing_rates; the invoice `total_commission` IS the billing-stream statement total (never the
 * rep payout). Money is a decimal STRING (#1). No GST anywhere. One line per customer.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportFormat } from '@prisma/client';

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

  @ApiProperty({ type: String, example: '90.00', description: 'Decimal string. Server-priced line total.' })
  line_total!: string;
}

export class ClientStatementResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string. Server-computed statement total (no GST).' })
  total_amount!: string;

  @ApiProperty()
  file_url!: string;

  @ApiProperty()
  generated_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;

  @ApiPropertyOptional({
    type: () => [ClientStatementLineResponse],
    description: 'Present on generate/detail; absent on the list.',
  })
  lines?: ClientStatementLineResponse[];
}

export class ClientInvoiceResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string = the billing-stream statement total (#3).' })
  total_commission!: string;

  @ApiProperty()
  file_url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;
}

/** The export action's response (stub file_url; the audit row is the persisted record). */
export class BillingExportResultResponse {
  @ApiPropertyOptional({ type: String, description: 'Set when exporting a statement.' })
  statement_id?: string;

  @ApiPropertyOptional({ type: String, description: 'Set when exporting an invoice.' })
  invoice_id?: string;

  @ApiProperty({ enum: ExportFormat })
  format!: ExportFormat;

  @ApiProperty()
  file_url!: string;

  @ApiProperty({ type: String, description: 'The serialized row payload (real render deferred).' })
  content!: string;
}
