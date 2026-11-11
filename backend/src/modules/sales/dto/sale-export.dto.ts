/**
 * Sales export log — request + response shapes. — client request 2026-11-11
 *
 * The FILTERS are exactly the sales list's (status / rep / client / date range / search), so an export holds
 * what the list shows, scoped server-side like the list (§5). `only_new` narrows it to sales never included
 * in an earlier sales export (company-wide), so nothing is counted twice in Redwave's Excel.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { PageMetaResponse } from '../../../common/pagination/page.response';
import { SaleResponse } from './sale.response';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const EXPORT_FORMATS = ['csv', 'excel', 'pdf'] as const;

/** The sales list's filters (no paging) — also the query string of GET /v1/sales/exports/summary. */
export class SaleExportFilters {
  @ApiPropertyOptional({ enum: SaleStatus })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rep_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE, { message: 'date_from must be a YYYY-MM-DD date' })
  date_from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DATE, { message: 'date_to must be a YYYY-MM-DD date' })
  date_to?: string;

  @ApiPropertyOptional({ description: 'Sale ID or customer name contains.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ExportSalesDto {
  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn([...EXPORT_FORMATS])
  format!: (typeof EXPORT_FORMATS)[number];

  @ApiProperty({ example: 'redwave-sales-20261111' })
  @IsString()
  @MaxLength(200)
  filename!: string;

  @ApiPropertyOptional({ type: () => SaleExportFilters })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleExportFilters)
  filters?: SaleExportFilters;

  @ApiPropertyOptional({ description: 'Only sales never included in an earlier sales export (company-wide).' })
  @IsOptional()
  @IsBoolean()
  only_new?: boolean;
}

/** One logged sales export. */
export class SaleExportLogResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Super Admin' })
  generated_by_name!: string | null;

  @ApiProperty({ enum: EXPORT_FORMATS })
  format!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty({ type: Number, nullable: true })
  row_count!: number | null;

  @ApiProperty()
  only_new!: boolean;

  @ApiProperty({ type: () => SaleExportFilters })
  filters!: SaleExportFilters;
}

export class SaleExportPageResponse {
  @ApiProperty({ type: () => [SaleExportLogResponse] })
  data!: SaleExportLogResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

export class SaleExportSummaryResponse {
  @ApiProperty({ description: 'Sales matching the filters (within the caller’s scope).' })
  matching!: number;

  @ApiProperty({ description: 'Of those, how many were never included in a sales export.' })
  not_yet_exported!: number;

  @ApiProperty({ type: () => SaleExportLogResponse, nullable: true })
  last_export!: SaleExportLogResponse | null;
}

export class SaleExportRecordResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;

  @ApiProperty()
  row_count!: number;

  @ApiProperty()
  only_new!: boolean;

  @ApiProperty({ enum: EXPORT_FORMATS })
  format!: string;
}

/** POST /v1/sales/exports — the recorded export + the rows to put in the file (same shape as the list). */
export class SaleExportResultResponse {
  @ApiProperty({ type: () => SaleExportRecordResponse, nullable: true, description: 'null when nothing matched (nothing is logged).' })
  export!: SaleExportRecordResponse | null;

  @ApiProperty({ type: () => [SaleResponse] })
  rows!: SaleResponse[];
}
