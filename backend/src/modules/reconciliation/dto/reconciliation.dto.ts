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
