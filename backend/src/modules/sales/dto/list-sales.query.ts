import { ApiPropertyOptional } from '@nestjs/swagger';
import { SaleStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// page/limit/sort/search come from PaginationQuery; sort allowlist: sale_code/customer_name/sale_date/status/created_at.
export class ListSalesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SaleStatus })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional({ description: 'Filter by rep (intersected with the caller’s scope).' })
  @IsOptional()
  @IsUUID()
  rep_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'sale_date >= (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(DATE, { message: 'date_from must be a YYYY-MM-DD date' })
  date_from?: string;

  @ApiPropertyOptional({ example: '2026-01-31', description: 'sale_date <= (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(DATE, { message: 'date_to must be a YYYY-MM-DD date' })
  date_to?: string;
}
