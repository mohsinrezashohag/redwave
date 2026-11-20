import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PayRunStatus } from '@prisma/client';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Create / refresh a DRAFT commission report.
 *
 * Since 2026-11-16 (client decision) a run is a SALE-DATE range, optionally one client and/or one rep:
 * send `date_from` + `date_to`. The legacy `pay_period_id` body is still accepted for compatibility, but
 * the app no longer sends it. Exactly one of the two shapes is required (422 otherwise).
 */
export class CreatePayRunDto {
  @ApiPropertyOptional({ description: 'LEGACY: a pre-loaded pay period. Not used by the app since 2026-11-16.' })
  @IsOptional()
  @IsUUID()
  pay_period_id?: string;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'First sale_date covered (inclusive, YYYY-MM-DD).' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date_from must be YYYY-MM-DD' })
  date_from?: string;

  @ApiPropertyOptional({ example: '2026-11-14', description: 'Last sale_date covered (inclusive, YYYY-MM-DD).' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date_to must be YYYY-MM-DD' })
  date_to?: string;

  @ApiPropertyOptional({ description: 'Limit the report to one client. Omit for all clients.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ description: 'Limit the report to one rep (or seller). Omit for all reps in scope.' })
  @IsOptional()
  @IsUUID()
  rep_id?: string;

  @ApiPropertyOptional({ example: 'November first half', description: 'Optional name shown in the history.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

/** GET /v1/pay-runs — the commission-report history (legacy period runs + range runs). */
export class ListPayRunsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: PayRunStatus })
  @IsOptional()
  @IsIn(Object.values(PayRunStatus))
  status?: PayRunStatus;

  @ApiPropertyOptional({ enum: ['period', 'range'], description: 'Legacy pay-period runs or date-range reports.' })
  @IsOptional()
  @IsIn(['period', 'range'])
  kind?: 'period' | 'range';

  @ApiPropertyOptional({ description: 'Only reports limited to this client.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ description: 'Only reports limited to this rep.' })
  @IsOptional()
  @IsUUID()
  rep_id?: string;
}

/** Narrow a payroll report / its workbook to one client or one rep (omit both for every rep). */
export class PayrollReportFilterQuery {
  @ApiPropertyOptional({ description: 'Only sales of this client.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ description: 'Only sales of this rep.' })
  @IsOptional()
  @IsUUID()
  rep_id?: string;
}
