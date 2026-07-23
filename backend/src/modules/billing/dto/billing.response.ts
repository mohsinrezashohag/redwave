/**
 * Billing response DTOs — the CLIENT-FACING billing stream the controllers return. — Batch A #2
 *
 * #3: these shapes carry NO commission/engine data — a statement is priced SOLELY from
 * client_billing_rates; the invoice `total_commission` IS the billing-stream statement total (never the
 * rep payout). Money is a decimal STRING (#1). No GST anywhere. One row per sale.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ONE ROW PER SALE — the full client-facing line: who sold it, to whom, where, which components were present,
 * and the amount from EACH rate kind. The columns added for the weekly billing format are nullable because
 * lines issued before it are immutable and were never rewritten.
 * — docs/uat/billing-target-format.md
 */
export class ClientStatementLineResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  statement_id!: string;

  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ type: Number, description: 'Render order as priced (sale_date, then sale_code).' })
  sort_order!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sale_date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'RW-D-0007', description: 'Agent ID (reps.rep_code).' })
  rep_code!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Agent name.' })
  rep_name!: string | null;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true })
  customer_first_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  customer_last_name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '452 Rue Saint-Paul, Montreal, QC, H2Y 2A6' })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VF', description: 'Channel (clients.client_code).' })
  channel!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Fibre 1gig/2.5gig', description: 'The internet speed product.' })
  product_name!: string | null;

  @ApiProperty({ example: 'Internet, TV, Home Phone' })
  products_summary!: string;

  @ApiProperty({ type: Boolean })
  has_internet!: boolean;

  @ApiProperty({ type: Boolean })
  has_tv!: boolean;

  @ApiProperty({ type: Boolean })
  has_home_phone!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '350.00', description: 'Decimal string. The internet product rate.' })
  internet_rate!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '50.00', description: 'Decimal string. tv_addon, else the TV product rate.' })
  tv_rate!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '50.00', description: 'Decimal string. hp_addon, else the HP product rate.' })
  hp_rate!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '35.00', description: 'Decimal string. The bundle bonus (trigger types all present).' })
  bundle_bonus!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '30.00', description: 'Decimal string. The date-bounded spiff.' })
  spiff!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.00', description: 'Decimal string. Priced products with no column of their own.' })
  other_total!: string | null;

  @ApiProperty({ type: String, example: '465.00', description: 'Decimal string. The EXACT sum of the components above.' })
  line_total!: string;
}

/** Counts + column totals summed from the FROZEN lines — never re-priced, so the UI does no arithmetic. */
export class StatementSummaryResponse {
  @ApiProperty({ type: Number })
  line_count!: number;

  @ApiProperty({ type: Number })
  internet_count!: number;

  @ApiProperty({ type: Number })
  tv_count!: number;

  @ApiProperty({ type: Number })
  home_phone_count!: number;

  @ApiProperty({ type: String, example: '19600.00' })
  internet_total!: string;

  @ApiProperty({ type: String, example: '650.00' })
  tv_total!: string;

  @ApiProperty({ type: String, example: '450.00' })
  hp_total!: string;

  @ApiProperty({ type: String, example: '0.00' })
  bundle_total!: string;

  @ApiProperty({ type: String, example: '1680.00' })
  spiff_total!: string;

  @ApiProperty({ type: String, example: '0.00' })
  other_total!: string;

  @ApiProperty({ type: String, example: '22380.00' })
  grand_total!: string;
}

/** A billing WEEK (Mon–Sun), numbered sequentially — "Bill 17". Separate from the biweekly pay period. */
export class BillingPeriodResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, example: 17, description: 'The sequential bill number.' })
  period_number!: number;

  @ApiProperty({ type: String, format: 'date-time', description: 'Monday.' })
  start_date!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Sunday.' })
  end_date!: string;

  @ApiProperty({ enum: ['open', 'closed', 'paid'] })
  status!: 'open' | 'closed' | 'paid';
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

  @ApiProperty({ type: String, nullable: true, description: 'The billing week ("Bill 17") this statement covers.' })
  billing_period_id!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Legacy (pre-weekly-billing) statements only.' })
  pay_period_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The applied spiff window start (column header).' })
  spiff_from!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The applied spiff window end.' })
  spiff_to!: string | null;

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

  @ApiPropertyOptional({ type: () => StatementSummaryResponse, description: 'Present on detail — the summary strip.' })
  summary?: StatementSummaryResponse;
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

  @ApiProperty({ type: String, nullable: true, description: 'The billing week ("Bill 17") this invoice covers.' })
  billing_period_id!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Legacy (pre-weekly-billing) invoices only.' })
  pay_period_id!: string | null;

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

/**
 * A statement PREVIEW — exactly the rows that WOULD be issued, NOT persisted (no number is minted). Same
 * shape as the frozen line, so what you preview is what gets issued.
 */
export class StatementPreviewLineResponse {
  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ type: Number })
  sort_order!: number;

  @ApiProperty({ type: String, example: '2026-06-29' })
  sale_date!: string;

  @ApiProperty()
  rep_code!: string;

  @ApiProperty()
  rep_name!: string;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty()
  customer_first_name!: string;

  @ApiProperty()
  customer_last_name!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  channel!: string;

  @ApiProperty({ example: 'Fibre 1gig/2.5gig' })
  product_name!: string;

  @ApiProperty({ example: 'Internet, TV, Home Phone' })
  products_summary!: string;

  @ApiProperty({ type: Boolean })
  has_internet!: boolean;

  @ApiProperty({ type: Boolean })
  has_tv!: boolean;

  @ApiProperty({ type: Boolean })
  has_home_phone!: boolean;

  @ApiProperty({ type: String, example: '350.00' })
  internet_rate!: string;

  @ApiProperty({ type: String, example: '50.00' })
  tv_rate!: string;

  @ApiProperty({ type: String, example: '50.00' })
  hp_rate!: string;

  @ApiProperty({ type: String, example: '35.00' })
  bundle_bonus!: string;

  @ApiProperty({ type: String, example: '30.00' })
  spiff!: string;

  @ApiProperty({ type: String, example: '0.00' })
  other_total!: string;

  @ApiProperty({ type: String, example: '465.00', description: 'Decimal string. The EXACT sum of the components.' })
  line_total!: string;
}

export class StatementPreviewResponse {
  @ApiProperty()
  client_id!: string;

  @ApiProperty({ description: 'The billing week ("Bill 17") previewed.' })
  billing_period_id!: string;

  @ApiProperty({ type: () => [StatementPreviewLineResponse], description: 'One row per sale, per-component (no GST).' })
  lines!: StatementPreviewLineResponse[];

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string. Draft total in the client currency.' })
  total_amount!: string;

  @ApiProperty({ type: () => StatementSummaryResponse, description: 'The summary strip for the draft.' })
  summary!: StatementSummaryResponse;
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
