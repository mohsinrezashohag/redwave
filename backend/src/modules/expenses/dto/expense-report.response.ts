/**
 * Report FOLDER response DTOs (report-as-folder, EXP-001). The folder's `status` is DERIVED (aggregate of
 * its items — never stored); `total_reimbursable_cad` is Σ frozen `amount_cad` of non-personal items (#1/#12
 * display only); `validation` is the aggregated Alert/Warning count (EXP-013). Money = decimal STRING.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaResponse } from '../../../common/pagination/page.response';
import { ExpenseItemResponse } from './expense.response';

const FOLDER_STATUS = ['empty', 'needs_attention', 'draft', 'pending', 'approved', 'rejected'] as const;

/** Aggregated Alert/Warning counts across a folder's items. */
export class FolderValidationResponse {
  @ApiProperty({ example: 0 })
  alert_count!: number;

  @ApiProperty({ example: 1 })
  warning_count!: number;

  @ApiProperty({ example: 1, description: 'Items with ≥1 alert or warning.' })
  flagged!: number;
}

export class ExpenseReportResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Week of 2026-07-06' })
  name!: string;

  @ApiProperty({ description: 'The folder owner (who created it).' })
  submitted_by!: string;

  @ApiProperty({ type: String, nullable: true })
  rep_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  week_start!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  week_end!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ example: 3, description: 'Number of items in the folder.' })
  item_count!: number;

  @ApiProperty({ type: String, example: '73.50', description: 'Σ frozen amount_cad of non-personal items (CAD, display).' })
  total_reimbursable_cad!: string;

  @ApiProperty({ enum: FOLDER_STATUS, description: 'DERIVED aggregate of the items’ statuses (EXP-001a).' })
  status!: (typeof FOLDER_STATUS)[number];

  @ApiProperty({ type: () => FolderValidationResponse })
  validation!: FolderValidationResponse;

  @ApiPropertyOptional({ type: () => [ExpenseItemResponse], description: 'The folder’s items (present on the detail GET).' })
  items?: ExpenseItemResponse[];

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'CREATE only: true when the caller already had a folder for this rep + week, so the existing one was ' +
      'returned instead of creating a duplicate. A week is a single container by design (EXP-001).',
  })
  reused?: boolean;
}

/** Paginated list envelope (arch §5.1) — one page of folders + the meta. */
export class ExpenseReportPageResponse {
  @ApiProperty({ type: () => [ExpenseReportResponse] })
  data!: ExpenseReportResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}
