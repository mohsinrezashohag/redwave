/**
 * Currency catalogue response — the allowed currency set (CAD/USD + admin-extensible). Read by the client
 * form (billing currency picker) and the expense form (per-item currency). — Meeting 3, CLAUDE §3 #12
 */
import { ApiProperty } from '@nestjs/swagger';

export class CurrencyResponse {
  @ApiProperty({ example: 'CAD', description: 'ISO 4217 code (the catalogue key).' })
  code!: string;

  @ApiProperty({ example: 'Canadian Dollar' })
  name!: string;

  @ApiProperty({ example: '$' })
  symbol!: string;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}
