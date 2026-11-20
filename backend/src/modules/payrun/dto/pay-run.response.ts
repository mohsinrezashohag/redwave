/**
 * Pay Run response DTOs — the documented shapes the Pay Run controllers return. — Batch A #2
 *
 * MONEY DISCIPLINE (#1): every Decimal is a decimal STRING. PayRunLine carries the money components + net,
 * all server-computed; the UI computes nothing. No tiers and no 70/30 since 2026-11-13. The nested
 * `pay_period` here is the FULL 6-field shape (≠ the sales-nested 4-field `SalePayPeriodResponse`); the
 * nested `rep` is a 3-field lite.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayPeriodStatus, PayRunStatus } from '@prisma/client';
import { PageMetaResponse } from '../../../common/pagination/page.response';

export class PayPeriodResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 3 })
  period_number!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  start_date!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  end_date!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  payday!: string;

  @ApiProperty({ enum: PayPeriodStatus })
  status!: PayPeriodStatus;
}

/** Minimal rep identity nested on a pay-run line (the full rep record lives in HRM). */
export class RepLiteResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  rep_code!: string;

  @ApiProperty()
  full_name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The rep's photo (HR headshot), short-lived URL." })
  photo_url?: string | null;
}

export class PayRunLineResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty({ type: () => RepLiteResponse })
  rep!: RepLiteResponse;

  @ApiProperty({ type: String, example: '2610.00', description: 'Decimal string. Commission (Σ item rates), paid in full.' })
  commission!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Approved expenses.' })
  expense_total!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Incentives (paid in full).' })
  incentive_total!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Ad-hoc bonus.' })
  bonus_amount!: string;

  @ApiProperty({ type: String, nullable: true })
  bonus_note!: string | null;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Flat clawback deductions.' })
  clawback_total!: string;

  @ApiProperty({ type: String, example: '2317.00', description: 'Decimal string. Net = commission + expenses + incentives + bonus − clawback (may be negative).' })
  net_payout!: string;

}

/** The client a range report is limited to. */
export class RunClientLiteResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  client_code!: string;

  @ApiProperty()
  name!: string;
}

/** The rep a range report is limited to. */
export class RunRepLiteResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  rep_code!: string;

  @ApiProperty()
  full_name!: string;
}

/**
 * A commission report header. Since 2026-11-16 a run is a SALE-DATE range (`kind: 'range'`), optionally one
 * client and/or one rep; legacy runs (`kind: 'period'`) carry a pay period instead. `window_start` /
 * `window_end` are the covered sale dates either way.
 */
export class PayRunSummaryResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['period', 'range'] })
  kind!: 'period' | 'range';

  @ApiProperty({ example: 'Pay period #6', description: 'The run label, else Pay period #N, else the date range.' })
  display_label!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The name the admin gave the report, if any.' })
  label!: string | null;

  @ApiProperty({ type: String, example: '2026-11-01', description: 'First sale_date covered (YYYY-MM-DD).' })
  window_start!: string;

  @ApiProperty({ type: String, example: '2026-11-14', description: 'Last sale_date covered (YYYY-MM-DD).' })
  window_end!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Legacy runs only.' })
  pay_period_id!: string | null;

  @ApiProperty({ type: () => PayPeriodResponse, nullable: true, description: 'Legacy runs only.' })
  pay_period!: PayPeriodResponse | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  date_from!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  date_to!: string | null;

  @ApiProperty({ type: String, nullable: true })
  client_id!: string | null;

  @ApiProperty({ type: () => RunClientLiteResponse, nullable: true, description: 'Set when limited to one client.' })
  client!: RunClientLiteResponse | null;

  @ApiProperty({ type: String, nullable: true })
  rep_id!: string | null;

  @ApiProperty({ type: () => RunRepLiteResponse, nullable: true, description: 'Set when limited to one rep.' })
  scope_rep!: RunRepLiteResponse | null;

  @ApiProperty({ type: String, format: 'date-time' })
  run_date!: string;

  @ApiProperty({ enum: PayRunStatus })
  status!: PayRunStatus;

  @ApiProperty()
  executed_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

/** A pay-run header + its scoped per-rep lines — the get/draft/finalize shape. */
export class PayRunResponse extends PayRunSummaryResponse {
  @ApiProperty({ type: () => [PayRunLineResponse] })
  lines!: PayRunLineResponse[];
}

/** The paginated commission-report history. */
export class PayRunPageResponse {
  @ApiProperty({ type: () => [PayRunSummaryResponse] })
  data!: PayRunSummaryResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

/** One item of a sale in a report: the REP rate (frozen once paid, the rate in force while a draft). */
export class RunSaleItemResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'internet' })
  product_type!: string;

  @ApiProperty({ type: String, nullable: true })
  product_name!: string | null;

  @ApiProperty({ type: String, example: '110.00', description: 'Decimal string. The rep rate.' })
  rate_applied!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Incentive on this item.' })
  incentive_amount!: string;

  @ApiProperty({ type: String, example: '110.00', description: 'Decimal string. Rate + incentive.' })
  commission_paid!: string;
}

/** One sale in a report for one rep — the per-sale drill-down. Rep stream only (#3). */
export class RunSaleResponse {
  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ example: '2026-11-03-VF' })
  sale_code!: string;

  @ApiProperty({ type: String, example: '2026-11-03' })
  sale_date!: string;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ example: 'VF' })
  client_code!: string;

  @ApiProperty()
  client_name!: string;

  @ApiProperty({ example: 'validated' })
  status!: string;

  @ApiProperty({ type: () => [RunSaleItemResponse] })
  items!: RunSaleItemResponse[];

  @ApiProperty({ type: String, example: '140.00', description: 'Decimal string. Σ commission_paid (server-summed).' })
  total!: string;
}

/** A rep's sales in one report. `basis` says whether the amounts are frozen (paid) or the draft preview. */
export class RunRepSalesResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty({ enum: ['paid', 'estimated'] })
  basis!: 'paid' | 'estimated';

  @ApiProperty({ type: () => [RunSaleResponse] })
  sales!: RunSaleResponse[];

  @ApiProperty({ type: String, description: 'Decimal string. Σ of the sales totals.' })
  total!: string;
}

export class ExportResultResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty({ enum: ['csv', 'json'], example: 'csv' })
  format!: 'csv' | 'json';

  @ApiProperty({ example: 12 })
  line_count!: number;

  @ApiProperty({ type: String, description: 'The rendered export payload (CSV text or JSON string).' })
  content!: string;
}

/**
 * ONE ROW of Redwave's payroll workbook — one SALE, with the rep amount each component earned and their
 * total (paid in full). Every money field is the FROZEN snapshot as a decimal STRING (#1/#2); nothing is recomputed
 * at read time, and no client billing rate is reachable from here (#3).
 */
export class PayrollReportLineResponse {
  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-03-02' })
  sale_date!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Redwave11',
    description: "Agent ID as Redwave's own workbooks key it (reps.external_code). Render `?? rep_code`.",
  })
  rep_external_code!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'RW-D-0001', description: 'Internal code; the fallback.' })
  rep_code!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rep_name!: string | null;

  @ApiProperty({ description: 'ONE column in this workbook — not split first/last like the client statement.' })
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true, description: 'One string: street, city, province, postal.' })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VF', description: 'clients.client_code.' })
  channel!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Fibre 1gig/2.5gig' })
  product_name!: string | null;

  @ApiProperty()
  has_internet!: boolean;

  @ApiProperty()
  has_tv!: boolean;

  @ApiProperty()
  has_home_phone!: boolean;

  @ApiProperty({ description: 'Greenfield internet, paid its own rate (#9) — its own column.' })
  is_greenfield!: boolean;

  @ApiProperty({ type: String, example: '125.00' })
  internet_rate!: string;

  @ApiProperty({ type: String, example: '30.00' })
  tv_rate!: string;

  @ApiProperty({ type: String, example: '30.00' })
  hp_rate!: string;

  @ApiProperty({ type: String, example: '100.00' })
  greenfield!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'The frozen incentive on this sale.' })
  spiff!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Priced items with no column of their own.' })
  other_total!: string;

  @ApiProperty({ type: String, example: '185.00', description: 'The exact sum of the components above.' })
  total_100!: string;
}

/** The payroll report for one pay run — the workbook's rows plus its row-1 SUBTOTAL strip. */
export class PayrollReportResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty({ type: Number, nullable: true, example: 6, description: 'Legacy pay-period runs only; null for a date-range report.' })
  period_number!: number | null;

  @ApiProperty({ enum: ['period', 'range'], description: 'A legacy pay-period run or a date-range commission report (2026-11-16).' })
  kind!: 'period' | 'range';

  @ApiProperty({ example: '2026-11-01 to 2026-11-14', description: 'The run label, else Pay period #N, else the date range.' })
  display_label!: string;

  @ApiProperty({ type: String, example: '2026-03-01' })
  period_start!: string;

  @ApiProperty({ type: String, example: '2026-03-14' })
  period_end!: string;

  @ApiProperty({ type: String, example: 'finalized' })
  run_status!: string;

  @ApiProperty({
    description:
      'False until the run finalizes. Lines are frozen AT finalize, so before then there is genuinely no ' +
      'money to report — the UI says so rather than showing zeros as though nothing was earned.',
  })
  is_finalized!: boolean;

  @ApiProperty({ type: [PayrollReportLineResponse] })
  lines!: PayrollReportLineResponse[];

  @ApiProperty({ type: String, description: 'Row-1 strip: Σ Total 100 %.' })
  total_100!: string;
}

/**
 * ONE LINE of a REP-FACING pay statement — deliberately a SEPARATE DTO from the admin payroll line, not a
 * reuse of it. Packet 03: "do not let the rep-facing endpoint reuse an admin serializer that happens to
 * include extra fields." What is ABSENT is the specification: no agent identifiers for anyone else, no
 * client rate, no margin, no org-wide total (#3).
 */
export class RepPayStatementLineResponse {
  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-03-02' })
  sale_date!: string | null;

  @ApiProperty({ description: 'The customer this rep sold to.' })
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VF' })
  channel!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Fibre 1gig/2.5gig' })
  product_name!: string | null;

  @ApiProperty()
  has_internet!: boolean;

  @ApiProperty()
  has_tv!: boolean;

  @ApiProperty()
  has_home_phone!: boolean;

  @ApiProperty()
  is_greenfield!: boolean;

  @ApiProperty({ type: String, example: '125.00', description: 'What the REP earned — never a client rate.' })
  internet_rate!: string;

  @ApiProperty({ type: String, example: '30.00' })
  tv_rate!: string;

  @ApiProperty({ type: String, example: '30.00' })
  hp_rate!: string;

  @ApiProperty({ type: String, example: '0.00' })
  greenfield!: string;

  @ApiProperty({ type: String, example: '0.00' })
  spiff!: string;

  @ApiProperty({ type: String, example: '0.00' })
  other_total!: string;

  @ApiProperty({ type: String, example: '185.00', description: 'What this sale earned the rep.' })
  total_100!: string;
}

/** One rep's statement for one pay run: per sale, what it paid the rep. */
export class RepPayStatementResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty({ type: Number, nullable: true, example: 6, description: 'Legacy pay-period runs only; null for a date-range report.' })
  period_number!: number | null;

  @ApiProperty({ enum: ['period', 'range'], description: 'A legacy pay-period run or a date-range commission report (2026-11-16).' })
  kind!: 'period' | 'range';

  @ApiProperty({ example: '2026-11-01 to 2026-11-14', description: 'The run label, else Pay period #N, else the date range.' })
  display_label!: string;

  @ApiProperty({ type: String, example: '2026-03-01' })
  period_start!: string;

  @ApiProperty({ type: String, example: '2026-03-14' })
  period_end!: string;

  @ApiProperty({ type: String, nullable: true, example: 'RW-D-0001' })
  rep_code!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rep_name!: string | null;

  @ApiProperty({ description: 'False until the run finalizes — nothing is owed before then.' })
  is_finalized!: boolean;

  @ApiProperty({ type: [RepPayStatementLineResponse] })
  lines!: RepPayStatementLineResponse[];

  @ApiProperty({ type: String })
  total_100!: string;
}

/** A statement the caller can open — the list a logged-in rep sees. */
export class RepPayStatementSummaryResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty({ type: Number, nullable: true, example: 6, description: 'Legacy pay-period runs only; null for a date-range report.' })
  period_number!: number | null;

  @ApiProperty({ enum: ['period', 'range'], description: 'A legacy pay-period run or a date-range commission report (2026-11-16).' })
  kind!: 'period' | 'range';

  @ApiProperty({ example: '2026-11-01 to 2026-11-14', description: 'The run label, else Pay period #N, else the date range.' })
  display_label!: string;

  @ApiProperty({ type: String, example: '2026-03-01' })
  period_start!: string;

  @ApiProperty({ type: String, example: '2026-03-14' })
  period_end!: string;

  @ApiProperty({ type: String, example: 'finalized' })
  run_status!: string;
}
