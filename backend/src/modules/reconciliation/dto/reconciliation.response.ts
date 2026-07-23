import { ApiProperty } from '@nestjs/swagger';

export class StatementTieOutRefResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true })
  statement_number!: number | null;

  @ApiProperty({ enum: ['issued', 'superseded'] })
  status!: 'issued' | 'superseded';
}

export class StatementTieOutResponse {
  @ApiProperty()
  client_id!: string;

  @ApiProperty({ description: 'The billing week ("Bill 17") the statement covers.' })
  billing_period_id!: string;

  @ApiProperty({ type: () => StatementTieOutRefResponse, nullable: true })
  statement!: StatementTieOutRefResponse | null;

  @ApiProperty({ type: String, description: 'The frozen statement total (CAD).' })
  frozen_total!: string;

  @ApiProperty({ type: String, description: 'Sum of the statement lines (CAD).' })
  lines_sum!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The live re-priced sales total now (null if it could not be priced).' })
  live_total!: string | null;

  @ApiProperty()
  total_equals_lines!: boolean;

  @ApiProperty()
  statement_matches_live!: boolean;

  @ApiProperty({ description: 'True when every check ties out.' })
  ok!: boolean;

  @ApiProperty({ type: [String], description: 'Human-readable discrepancy flags (empty when ok).' })
  discrepancies!: string[];
}

export class PayRunLineTieOutResponse {
  @ApiProperty()
  rep_id!: string;

  @ApiProperty({ type: String, nullable: true })
  rep_code!: string | null;

  @ApiProperty({ type: String })
  stored_net!: string;

  @ApiProperty({ type: String, description: 'Net recomputed from the line components.' })
  recomputed_net!: string;

  @ApiProperty()
  ok!: boolean;
}

export class PayRunTieOutResponse {
  @ApiProperty()
  pay_run_id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  line_count!: number;

  @ApiProperty({ type: String, description: 'Sum of the lines’ net_payout (CAD).' })
  run_total!: string;

  @ApiProperty()
  ok!: boolean;

  @ApiProperty({ type: () => [PayRunLineTieOutResponse], description: 'Lines whose stored net ≠ the recomputed net (empty when ok).' })
  discrepancies!: PayRunLineTieOutResponse[];
}
