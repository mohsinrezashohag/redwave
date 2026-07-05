/**
 * KM-rate config DTOs — per-client, effective-dated kilometre rate (Meeting 3, EXP-004). Two-stream:
 * `rep` (reimbursement) / `client_bill`. rate_per_km is an exact-decimal STRING (#1). client_id omitted
 * = the GLOBAL default. Back-dating is rejected in the service (protects paid cycles, #10).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KmRateStream } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const RATE = /^\d+(\.\d{1,3})?$/; // $/km, up to 3 dp
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateKmRateDto {
  @ApiProperty({ enum: KmRateStream, example: 'rep', description: 'rep (reimbursement) or client_bill (#3).' })
  @IsEnum(KmRateStream)
  stream!: KmRateStream;

  @ApiPropertyOptional({ description: 'Client scope; omit for the GLOBAL default rate.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiProperty({ example: '0.450', description: 'Rate $/km (decimal string, up to 3 dp).' })
  @Matches(RATE, { message: 'rate_per_km must be a decimal string with up to 3 decimal places' })
  rate_per_km!: string;

  @ApiProperty({ example: '2026-08-01', description: 'Effective-from (YYYY-MM-DD). Back-dating is rejected.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Optional effective-to (open-ended if omitted).' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;
}

export class ListKmRatesQuery {
  @ApiPropertyOptional({ enum: KmRateStream })
  @IsOptional()
  @IsEnum(KmRateStream)
  stream?: KmRateStream;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ enum: ['current', 'pending', 'past', 'all'] })
  @IsOptional()
  @IsIn(['current', 'pending', 'past', 'all'])
  status?: 'current' | 'pending' | 'past' | 'all';
}
