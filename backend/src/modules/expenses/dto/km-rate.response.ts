/**
 * KM-rate config response — one effective-dated km-rate row + its derived status. rate_per_km is a
 * decimal STRING (#1). client_id null = the global default. — EXP-004
 */
import { ApiProperty } from '@nestjs/swagger';
import { KmRateStream } from '@prisma/client';

export class KmRateResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Client scope; null = global default.' })
  client_id!: string | null;

  @ApiProperty({ enum: KmRateStream })
  stream!: KmRateStream;

  @ApiProperty({ type: String, example: '0.450', description: 'Rate $/km (decimal string).' })
  rate_per_km!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  effective_from!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effective_to!: string | null;

  @ApiProperty({ enum: ['current', 'pending', 'past'], description: 'Derived status (server-computed).' })
  status!: 'current' | 'pending' | 'past';

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}
