/**
 * Business / executive dashboard response (Super Admin, reports:business). A READ-ONLY aggregation over the
 * frozen ledger/snapshots for the selected pay period (default = current) — NO money is recomputed. Every
 * money field is an exact-decimal string; ratios/growth are display values. — SRS §14, CLAUDE §3/§5
 */
import { ApiProperty } from '@nestjs/swagger';
import { DashPeriodResponse } from './reporting.response';

class NamedCountResponse {
  @ApiProperty({ example: 'internet', description: 'Key (product-type key or client code).' })
  key!: string;

  @ApiProperty({ example: 'Internet' })
  label!: string;

  @ApiProperty({ example: 12 })
  count!: number;
}

class HoldbackBreakdownResponse {
  @ApiProperty({ type: String, example: '3000.00', description: 'Decimal — currently held (status=held).' })
  held!: string;

  @ApiProperty({ type: String, example: '500.00', description: 'Decimal — scheduled to release (status=scheduled).' })
  scheduled!: string;

  @ApiProperty({ type: String, example: '993.00', description: 'Decimal — released in this period (30% advance release).' })
  released_this_period!: string;
}

class ExpenseBreakdownResponse {
  @ApiProperty({ type: String, example: '420.00', description: 'Decimal — total approved expenses (period).' })
  total!: string;

  @ApiProperty({ type: String, example: '120.00', description: 'Decimal — KM mileage portion.' })
  km!: string;

  @ApiProperty({ type: String, example: '300.00', description: 'Decimal — everything else.' })
  other!: string;
}

class GreenfieldStatResponse {
  @ApiProperty({ example: 2, description: 'Greenfield internet activations (excluded from the tally).' })
  count!: number;

  @ApiProperty({ type: String, example: '200.00', description: 'Decimal — frozen commission_paid on those items.' })
  amount!: string;
}

class ValidationFunnelResponse {
  @ApiProperty({ example: 3 }) entered!: number;
  @ApiProperty({ example: 20 }) validated!: number;
  @ApiProperty({ example: 12 }) in_pay_run!: number;
  @ApiProperty({ example: 40 }) paid!: number;
}

class TierCountResponse {
  @ApiProperty({ example: 2, description: 'Tier number (1 highest .. 4 entry).' })
  tier_number!: number;

  @ApiProperty({ example: 5, description: 'Reps whose period tally lands in this tier.' })
  rep_count!: number;
}

class ClientMixRowResponse {
  @ApiProperty({ example: 'VF' }) client_code!: string;
  @ApiProperty({ example: 'Valley Fiber' }) client_name!: string;
  @ApiProperty({ type: String, example: '6000.00', description: 'Decimal — revenue.' }) revenue!: string;
  @ApiProperty({ type: String, example: '50.0', description: 'Decimal — % of total revenue.' }) revenue_pct!: string;
  @ApiProperty({ example: 24, description: 'Activation volume.' }) volume!: number;
  @ApiProperty({ type: String, example: '48.0', description: 'Decimal — % of total volume.' }) volume_pct!: string;
}

class GrowthMoneyResponse {
  @ApiProperty({ type: String, example: '12000.00' }) current!: string;
  @ApiProperty({ type: String, example: '10000.00' }) previous!: string;
  @ApiProperty({ type: String, nullable: true, example: '20.0', description: 'Decimal % vs previous; null if no prior.' })
  pct!: string | null;
}

class GrowthCountResponse {
  @ApiProperty({ example: 60 }) current!: number;
  @ApiProperty({ example: 50 }) previous!: number;
  @ApiProperty({ type: String, nullable: true, example: '20.0' }) pct!: string | null;
}

export class BusinessDashboardResponse {
  @ApiProperty({ type: () => DashPeriodResponse, nullable: true, description: 'The period in scope (null = all-time).' })
  period!: DashPeriodResponse | null;

  // ── Money (read from frozen tables; net margin is a display subtraction) ──
  @ApiProperty({ type: String, example: '12000.00' }) revenue!: string;
  @ApiProperty({ type: String, example: '8000.00' }) rep_payout!: string;
  @ApiProperty({ type: String, example: '4000.00' }) net_margin!: string;
  @ApiProperty({ type: String, example: '33.3', description: 'Decimal % = margin / revenue.' }) net_margin_pct!: string;

  @ApiProperty({ type: () => HoldbackBreakdownResponse }) holdback!: HoldbackBreakdownResponse;

  @ApiProperty({ type: String, example: '145.00' }) clawback_total!: string;
  @ApiProperty({ type: String, example: '0.0181', description: 'Decimal ratio = clawback $ / paid commission $.' })
  clawback_rate!: string;

  @ApiProperty({ type: () => ExpenseBreakdownResponse }) expense!: ExpenseBreakdownResponse;

  // ── Activations ──
  @ApiProperty({ example: 60 }) total_activations!: number;
  @ApiProperty({ example: 48, description: 'Non-greenfield internet (the tally driver).' }) internet_activations!: number;
  @ApiProperty({ type: () => GreenfieldStatResponse }) greenfield!: GreenfieldStatResponse;
  @ApiProperty({ type: () => [NamedCountResponse] }) activations_by_product!: NamedCountResponse[];
  @ApiProperty({ type: () => [NamedCountResponse] }) activations_by_client!: NamedCountResponse[];

  // ── Funnel + reps ──
  @ApiProperty({ type: () => ValidationFunnelResponse }) validation_funnel!: ValidationFunnelResponse;
  @ApiProperty({ example: 8 }) active_rep_count!: number;
  @ApiProperty({ type: () => [TierCountResponse] }) tier_distribution!: TierCountResponse[];

  // ── Client mix + growth ──
  @ApiProperty({ type: () => [ClientMixRowResponse] }) client_mix!: ClientMixRowResponse[];
  @ApiProperty({ type: () => GrowthMoneyResponse }) revenue_growth!: GrowthMoneyResponse;
  @ApiProperty({ type: () => GrowthCountResponse }) activation_growth!: GrowthCountResponse;
}
