/**
 * Import response DTOs — a staged batch + its rows. — Batch A #2
 *
 * `reconcile_total` is a money STRING|null (#1). The JSON blobs `raw_data`/`mapped_data` are free-form
 * (`additionalProperties:true`); `error_summary` is a counts map (`additionalProperties:{type:number}`).
 * `import_rows` is present on detail/stage/reconcile/commit but ABSENT on the list (optional).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportBatchStatus, ImportSourceType, ImportType, MatchStatus } from '@prisma/client';

export class ImportRowResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  import_batch_id!: string;

  @ApiProperty({ example: 1 })
  row_number!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The original source row.' })
  raw_data!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'After field mapping.' })
  mapped_data!: Record<string, unknown> | null;

  @ApiProperty({ enum: MatchStatus })
  match_status!: MatchStatus;

  @ApiProperty({ type: String, nullable: true, description: 'The live entity this row resolves to.' })
  matched_entity_id!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Why the row is unmatched/error.' })
  issue!: string | null;

  @ApiProperty({ type: String, nullable: true })
  resolved_by!: string | null;
}

export class ImportBatchResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  source_file_url!: string;

  @ApiProperty({ enum: ImportSourceType })
  source_type!: ImportSourceType;

  @ApiProperty({ enum: ImportType })
  import_type!: ImportType;

  @ApiProperty({ type: String, nullable: true })
  client_id!: string | null;

  @ApiProperty({ type: String, nullable: true })
  field_mapping_id!: string | null;

  @ApiProperty({ enum: ImportBatchStatus })
  status!: ImportBatchStatus;

  @ApiProperty({ example: 3 })
  total_rows!: number;

  @ApiProperty({ example: 2 })
  matched_rows!: number;

  @ApiProperty({ example: 1 })
  error_rows!: number;

  @ApiProperty({ type: String, nullable: true, example: '100.00', description: 'Decimal string — operator-provided source total.' })
  reconcile_total!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    nullable: true,
    description: 'Counts by classification (matched/unmatched/...).',
  })
  error_summary!: Record<string, number> | null;

  @ApiProperty()
  run_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  committed_at!: string | null;

  @ApiPropertyOptional({
    type: () => [ImportRowResponse],
    description: 'Present on detail/stage/reconcile/commit; absent on the list.',
  })
  import_rows?: ImportRowResponse[];
}
