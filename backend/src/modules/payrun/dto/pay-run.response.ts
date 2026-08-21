/**
 * Pay Run response DTOs — the documented shapes the Pay Run controllers return. — Batch A #2
 *
 * MONEY DISCIPLINE (#1): every Decimal is a decimal STRING. PayRunLine carries the 7 money components +
 * net, PLUS the engine's reconciliation facts (gross, the 30% held, tier, tally, rate) so the 70/30 split
 * is provable without any UI arithmetic — all server-computed; the UI computes nothing. The nested
 * `pay_period` here is the FULL 6-field shape (≠ the sales-nested 4-field `SalePayPeriodResponse`); the
 * nested `rep` is a 3-field lite.
 */
import { ApiProperty } from '@nestjs/swagger';
import { HoldbackReleaseStatus, PayPeriodStatus, PayRunStatus } from '@prisma/client';

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

  @ApiProperty({ type: String, example: '2317.00', description: 'Decimal string. 70% advance (engine).' })
  commission_70!: string;

  @ApiProperty({ type: String, example: '993.00', description: 'Decimal string. 30% released from prior periods.' })
  holdback_release_30!: string;

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

  @ApiProperty({ type: String, example: '2317.00', description: 'Decimal string. Net = 70 + 30 + exp + inc + bonus − clawback (may be negative).' })
  net_payout!: string;

  // ── Reconciliation facts (engine pass-through; null on pre-migration rows) ────────────────────────
  @ApiProperty({
    type: String,
    nullable: true,
    example: '3310.00',
    description:
      'Decimal string. The 70/30 BASE (Σ commission base; EXCLUDES incentives, which are paid in full). ' +
      'Always gross_commission = commission_70 + amount_held.',
  })
  gross_commission!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '993.00',
    description: "Decimal string. THIS period's 30% held back (recorded on the holdback ledger at finalize).",
  })
  amount_held!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2, description: 'Tier the internet activations were paid at; null when the tally is 0.' })
  tier_at_payment!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 20, description: 'Gross non-greenfield internet count across ALL clients that drove the tier (#5/#9).' })
  internet_tally!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '145.00', description: 'Decimal string. Tier rate applied per internet activation; null when there is no tier.' })
  rate_per_activation!: string | null;
}

/** A pay period reduced to what the holdback summary needs to say WHEN a hold releases. */
export class HoldbackPeriodRefResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 14 })
  period_number!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  payday!: string;
}

/** One origin period's hold, as recorded on the holdback ledger. */
export class HoldbackByOriginResponse {
  @ApiProperty({ type: () => HoldbackPeriodRefResponse })
  origin_period!: HoldbackPeriodRefResponse;

  @ApiProperty({ type: String, example: '993.00', description: 'Decimal string. Held from that origin period.' })
  amount_held!: string;

  @ApiProperty({ type: () => HoldbackPeriodRefResponse, nullable: true, description: 'When it releases (null if unscheduled).' })
  scheduled_release_period!: HoldbackPeriodRefResponse | null;

  @ApiProperty({ enum: HoldbackReleaseStatus })
  release_status!: HoldbackReleaseStatus;

  @ApiProperty({ type: String, nullable: true, example: '993.00', description: 'Decimal string. Amount actually released.' })
  amount_released!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.00', description: 'Decimal string. Clawback set off against the hold.' })
  clawback_applied!: string | null;
}

/**
 * The run's period-level 30% (deferred pay) view — every figure SERVER-computed so the UI does no
 * arithmetic. On a DRAFT the current period's hold + release period are a projection (no ledger rows exist
 * until finalize); once finalized they are read from the frozen `holdback_ledger`.
 */
export class PayRunHoldbackSummaryResponse {
  @ApiProperty({ type: Boolean, description: 'True while the run is a draft — held/release figures are a projection.' })
  is_projection!: boolean;

  @ApiProperty({ type: String, example: '993.00', description: "Decimal string. THIS period's 30% withheld (Σ line amount_held)." })
  held_this_period!: string;

  @ApiProperty({ type: () => HoldbackPeriodRefResponse, nullable: true, description: "The period THIS period's hold releases into." })
  held_release_period!: HoldbackPeriodRefResponse | null;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Prior holds maturing INTO this period.' })
  releasing_this_period!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string. Clawback set off against those releases.' })
  clawback_setoff_this_period!: string;

  @ApiProperty({ type: String, example: '1986.00', description: 'Decimal string. All still-unreleased holds for this run’s reps.' })
  outstanding_total!: string;

  @ApiProperty({ type: () => [HoldbackByOriginResponse] })
  by_origin!: HoldbackByOriginResponse[];
}

/** A pay-run header (no lines) — the list shape. */
export class PayRunSummaryResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: () => PayPeriodResponse })
  pay_period!: PayPeriodResponse;

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

export class HoldbackLedgerResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty()
  origin_pay_period_id!: string;

  @ApiProperty({ type: String, example: '993.00', description: 'Decimal string. The 30% held this origin period.' })
  amount_held!: string;

  @ApiProperty({ type: String, nullable: true })
  scheduled_release_period_id!: string | null;

  @ApiProperty({ enum: HoldbackReleaseStatus })
  release_status!: HoldbackReleaseStatus;

  @ApiProperty({ type: String, nullable: true })
  released_in_pay_run_id!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '993.00', description: 'Decimal string. Amount released.' })
  amount_released!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.00', description: 'Decimal string. Clawback applied against the hold.' })
  clawback_applied!: string | null;
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
 * ONE ROW of Redwave's payroll workbook — one SALE, with the rep amount each component earned and the
 * 70/30 split. Every money field is the FROZEN snapshot as a decimal STRING (#1/#2); nothing is recomputed
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

  @ApiProperty({ description: 'Flat-rated and excluded from the tier tally (#9) — its own column.' })
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

  @ApiProperty({ type: String, example: '129.50' })
  advance_70!: string;

  @ApiProperty({ type: String, example: '55.50' })
  holdback_30!: string;
}

/** The payroll report for one pay run — the workbook's rows plus its row-1 SUBTOTAL strip. */
export class PayrollReportResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty({ type: Number, example: 6 })
  period_number!: number;

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

  @ApiProperty({ type: String, description: 'Row-1 strip: Σ 0.7.' })
  advance_70!: string;

  @ApiProperty({ type: String, description: 'Row-1 strip: Σ 0.3.' })
  holdback_30!: string;
}
