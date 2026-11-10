/**
 * Margin response DTOs. Every money field is a decimal STRING (#1). `currency` is on every row and every
 * group because two currencies are never summed (#12) — a foreign client's margin is reported in that
 * client's currency, not converted at a rate nobody froze.
 */
import { ApiProperty } from '@nestjs/swagger';

export class MarginRowResponse {
  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-03-02' })
  sale_date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VF' })
  client_code!: string | null;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Fibre 1gig/2.5gig' })
  product_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rep_code!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rep_name!: string | null;

  @ApiProperty({ example: 'CAD', description: 'The document currency. Rows are never converted (#12).' })
  currency!: string;

  @ApiProperty({ type: String, example: '350.00', description: 'The frozen statement line total.' })
  client_billed!: string;

  @ApiProperty({
    type: String,
    example: '145.00',
    description: 'The frozen payroll line total at 100%. Zero when the sale is billed but not yet paid.',
  })
  rep_paid!: string;

  @ApiProperty({ type: String, example: '205.00', description: 'client_billed − rep_paid. Negative is shown.' })
  margin!: string;

  @ApiProperty({ type: String, nullable: true, example: '58.6', description: 'Null when the bill is zero.' })
  margin_pct!: string | null;
}

export class MarginGroupResponse {
  @ApiProperty({ description: 'Grouping key, suffixed with the currency so two are never merged.' })
  key!: string;

  @ApiProperty({ example: 'Fibre 1gig/2.5gig' })
  label!: string;

  @ApiProperty({ example: 'CAD' })
  currency!: string;

  @ApiProperty({ type: String })
  client_billed!: string;

  @ApiProperty({ type: String })
  rep_paid!: string;

  @ApiProperty({ type: String })
  margin!: string;

  @ApiProperty({ type: String, nullable: true })
  margin_pct!: string | null;

  @ApiProperty({ type: Number })
  sale_count!: number;
}

/** One bracket of a tiered product's rep rate. */
export class RepTierRateResponse {
  @ApiProperty({ type: Number, example: 2 })
  tier_number!: number;

  @ApiProperty({ type: String, example: '145.00' })
  amount!: string;
}

export class RateInForceResponse {
  @ApiProperty({ type: String, nullable: true })
  product_id!: string | null;

  @ApiProperty({ example: 'Fibre 1gig/2.5gig' })
  product_name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'internet' })
  product_type!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VF' })
  client_code!: string | null;

  @ApiProperty({ example: 'CAD' })
  currency!: string;

  @ApiProperty({ type: String, example: '350.00', description: 'What the CLIENT is charged.' })
  client_rate!: string;

  @ApiProperty({ type: String, example: '2026-01-01' })
  client_rate_from!: string;

  @ApiProperty({ type: String, nullable: true })
  client_rate_to!: string | null;

  @ApiProperty({
    type: [RepTierRateResponse],
    description:
      "Per-product tier overrides. A tiered product's rep rate depends on the period's volume, so every " +
      'bracket is listed rather than one number that would be right only sometimes.',
  })
  rep_tier_rates!: RepTierRateResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '30.00',
    description: "The flat rep rate for an add-on — its own product rate, else its product TYPE's.",
  })
  rep_flat_rate!: string | null;
}
