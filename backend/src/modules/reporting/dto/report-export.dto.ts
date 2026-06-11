/**
 * Report-export DTOs — /v1/report-exports (SRS RPT-015). `report_type` + `format` are allowlisted Strings
 * (no enum migration per new type); the per-type PERMISSION check lives in the service (a controller
 * decorator can't vary by body). `filename` records what the client downloaded.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export const REPORT_TYPES = ['business_summary', 'leaderboard', 'payrun_summary', 'expense_summary'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ['csv', 'excel', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateReportExportDto {
  @ApiProperty({ enum: REPORT_TYPES, description: 'Which report was generated.' })
  @IsIn(REPORT_TYPES)
  report_type!: ReportType;

  @ApiProperty({ enum: REPORT_FORMATS })
  @IsIn(REPORT_FORMATS)
  format!: ReportFormat;

  @ApiProperty({ maxLength: 200, description: 'The downloaded file name (client-generated file).' })
  @IsString()
  @MaxLength(200)
  filename!: string;

  @ApiPropertyOptional({ description: 'Pay period scope (business / pay-run summaries).' })
  @IsOptional()
  @IsUUID()
  pay_period_id?: string;

  @ApiPropertyOptional({ example: '2026-01-04', description: 'Date-range start (expense summary).' })
  @IsOptional()
  @Matches(DATE_RE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-01-17', description: 'Date-range end (expense summary).' })
  @IsOptional()
  @Matches(DATE_RE)
  to?: string;
}

export class ReportExportResponse {
  @ApiProperty() id!: string;
  @ApiProperty() generated_by!: string;
  @ApiProperty({ enum: REPORT_TYPES }) report_type!: string;
  @ApiProperty({ enum: REPORT_FORMATS }) format!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The exported scope (period/date range + recorded rep_scope).' })
  scope_filters!: Record<string, unknown>;
  @ApiProperty() filename!: string;
  @ApiProperty({ type: String, format: 'date-time' }) generated_at!: string;
}
