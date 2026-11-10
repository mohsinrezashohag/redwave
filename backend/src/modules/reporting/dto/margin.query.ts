import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MarginQuery {
  @ApiProperty({ example: '2026-03-01', description: 'Inclusive start of the sale-date range.' })
  @Matches(DATE, { message: 'from must be a YYYY-MM-DD date' })
  from!: string;

  @ApiProperty({ example: '2026-03-31', description: 'Inclusive end of the sale-date range.' })
  @Matches(DATE, { message: 'to must be a YYYY-MM-DD date' })
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to one client.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;
}

export class MarginRollupQuery extends MarginQuery {
  @ApiProperty({ enum: ['product', 'client', 'rep'], description: 'The grouping dimension.' })
  @IsIn(['product', 'client', 'rep'])
  by!: 'product' | 'client' | 'rep';
}

export class RatesInForceQuery {
  @ApiProperty({ example: '2026-09-07', description: 'The date to resolve rates on.' })
  @Matches(DATE, { message: 'on must be a YYYY-MM-DD date' })
  on!: string;

  @ApiPropertyOptional({ description: 'Narrow to one client.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;
}
