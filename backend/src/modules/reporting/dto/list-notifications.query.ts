import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

/** Filters for the caller's own notification list (paginated; page/limit/sort/search from PaginationQuery). */
export class ListNotificationsQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Filter by read/unread.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  is_read?: boolean;
}
