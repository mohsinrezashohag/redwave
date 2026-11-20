/**
 * Sale edit requests — a rep's change to their own sale within the 5-day window, held for an admin/manager
 * to approve (applied through the same edit path) or reject. — client meeting 2026-11-16
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';
import { PageMetaResponse } from '../../../common/pagination/page.response';

export const EDIT_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type EditRequestStatus = (typeof EDIT_REQUEST_STATUSES)[number];

export class ListSaleEditRequestsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: EDIT_REQUEST_STATUSES, description: 'Default: every status.' })
  @IsOptional()
  @IsIn([...EDIT_REQUEST_STATUSES])
  status?: EditRequestStatus;
}

/** One changed field, shown as before → after (display strings; products by name). */
export class SaleEditDiffResponse {
  @ApiProperty({ example: 'street' })
  field!: string;

  @ApiProperty({ example: 'Street' })
  label!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The sale’s CURRENT value.' })
  before!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'The requested value.' })
  after!: string | null;
}

export class SaleEditRequestResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sale_id!: string;

  @ApiProperty({ example: '2026-11-14-VF' })
  sale_code!: string;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true })
  rep_name!: string | null;

  @ApiProperty()
  requested_by!: string;

  @ApiProperty({ type: String, nullable: true })
  requested_by_name!: string | null;

  @ApiProperty({ enum: EDIT_REQUEST_STATUSES })
  status!: EditRequestStatus;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Only the changed fields (raw).' })
  changes!: Record<string, unknown>;

  @ApiProperty({ type: () => [SaleEditDiffResponse] })
  diff!: SaleEditDiffResponse[];

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decided_by!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decided_by_name!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  decided_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, example: '2026-11-19', description: 'Last day (Winnipeg) the sale may be edited.' })
  edit_window_ends_on!: string;

  @ApiProperty({ description: 'True while the sale is still editable (status + window).' })
  sale_editable!: boolean;
}

export class SaleEditRequestPageResponse {
  @ApiProperty({ type: () => [SaleEditRequestResponse] })
  data!: SaleEditRequestResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}
