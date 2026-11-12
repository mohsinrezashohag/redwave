/**
 * Cross-period trends response (Super Admin, reports:business). One row per pay period for the headline
 * series, plus per-period breakdowns by product (activations) and by client (revenue), and the tier
 * distribution over time. READ-ONLY aggregation — money is exact-decimal strings. — SRS §14
 */
import { ApiProperty } from '@nestjs/swagger';

export class TrendPeriodResponse {
  @ApiProperty({ example: 3 }) period_number!: number;
  @ApiProperty({ type: String, example: '12000.00' }) revenue!: string;
  @ApiProperty({ type: String, example: '8000.00' }) payout!: string;
  @ApiProperty({ type: String, example: '4000.00' }) net_margin!: string;
  @ApiProperty({ example: 60 }) activations!: number;
  @ApiProperty({ example: 48 }) internet_activations!: number;
  @ApiProperty({ type: String, example: '145.00' }) clawback_total!: string;
}

export class TrendProductResponse {
  @ApiProperty({ example: 3 }) period_number!: number;
  @ApiProperty({ type: String, example: 'internet' }) product_type!: string;
  @ApiProperty({ example: 12 }) count!: number;
}

export class TrendClientRevenueResponse {
  @ApiProperty({ example: 3 }) period_number!: number;
  @ApiProperty({ example: 'VF' }) client_code!: string;
  @ApiProperty({ type: String, example: '6000.00' }) amount!: string;
}

export class TrendTierResponse {
  @ApiProperty({ example: 3 }) period_number!: number;
  @ApiProperty({ example: 2 }) tier_number!: number;
  @ApiProperty({ example: 5 }) rep_count!: number;
}

export class BusinessTrendsResponse {
  @ApiProperty({ type: () => [TrendPeriodResponse] }) periods!: TrendPeriodResponse[];
  @ApiProperty({ type: () => [TrendProductResponse] }) by_product!: TrendProductResponse[];
  @ApiProperty({ type: () => [TrendClientRevenueResponse] }) by_client_revenue!: TrendClientRevenueResponse[];
  @ApiProperty({ type: () => [TrendTierResponse] }) tier_distribution!: TrendTierResponse[];
}
