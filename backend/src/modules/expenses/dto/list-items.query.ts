/**
 * Filters for the expense-ITEM list (item-first). Extends the shared pagination contract
 * (`?page=&limit=&sort=field:dir&search=`) with the expense filters. Results are always
 * scope-restricted in the query (§5); the `sort` allowlist lives in the service. — SRS §11
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseReportStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListExpenseItemsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ExpenseReportStatus })
  @IsOptional()
  @IsEnum(ExpenseReportStatus)
  status?: ExpenseReportStatus;

  @ApiPropertyOptional({ example: 'meals', description: 'Expense category key from the catalogue.' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by rep.' })
  @IsOptional()
  @IsUUID()
  rep_id?: string;

  @ApiPropertyOptional({ description: 'Filter by the client tagged on the item.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ description: 'Filter by pay period.' })
  @IsOptional()
  @IsUUID()
  pay_period_id?: string;

  @ApiPropertyOptional({ example: '2026-03-01', description: 'Items whose expense_date ≥ this date.' })
  @IsOptional()
  @Matches(DATE, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31', description: 'Items whose expense_date ≤ this date.' })
  @IsOptional()
  @Matches(DATE, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}
