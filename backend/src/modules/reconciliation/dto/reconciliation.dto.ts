import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StatementReconciliationQuery {
  @ApiProperty()
  @IsUUID()
  client_id!: string;

  @ApiProperty({ description: 'The billing week ("Bill 17") the statement covers.' })
  @IsUUID()
  billing_period_id!: string;
}

/**
 * An expense document is keyed by the PAY period (an item's period comes from its own expense_date), NOT
 * the Mon–Sun billing week a statement uses. The two calendars are never substituted (§14 rule 1).
 */
export class ExpenseDocReconciliationQuery {
  @ApiProperty()
  @IsUUID()
  client_id!: string;

  @ApiProperty({ description: 'The PAY period the expense document covers.' })
  @IsUUID()
  pay_period_id!: string;
}
