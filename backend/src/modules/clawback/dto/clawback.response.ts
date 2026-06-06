/**
 * Clawback response DTO — the documented shape the ClawbackController returns (flat record, no joins).
 * The `amount` is the exact frozen recovery (rate + incentive), a decimal STRING (#1). `reported_date`
 * is stored only — drives no logic (#6). — Batch A #2
 */
import { ApiProperty } from '@nestjs/swagger';
import { ClawbackStatus } from '@prisma/client';

export class ClawbackResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sale_item_id!: string;

  @ApiProperty()
  sale_id!: string;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty({ type: String, example: '145.00', description: 'Decimal string. Exact amount paid (rate + incentive).' })
  amount!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Informational only — no window is computed (#6).' })
  reported_date!: string;

  @ApiProperty()
  entered_by!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Set when a pay run applies the deduction.' })
  applied_in_pay_run_id!: string | null;

  @ApiProperty({ enum: ClawbackStatus })
  status!: ClawbackStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}
