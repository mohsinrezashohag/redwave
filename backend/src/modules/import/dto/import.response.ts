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

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
    description: 'The `{ systemField: sourceColumn }` mapping actually applied to this batch.',
  })
  applied_mapping!: Record<string, string> | null;

  @ApiProperty({ description: 'Whether the batch may create referenced master data at commit.' })
  create_missing!: boolean;

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

/** Stage also returns the parsed headers so the FE can offer them as mapping choices. */
export class StagedImportResponse extends ImportBatchResponse {
  @ApiPropertyOptional({ type: [String], description: 'The parsed source column headers.' })
  source_headers?: string[];
}

/** One DISTINCT problem across the file, with example rows — not one entry per failing row. */
export class ImportIssueGroupResponse {
  @ApiProperty({ description: 'The problem, with row-specific values folded out so identical issues group.' })
  issue!: string;

  @ApiProperty({ example: 'error' })
  match_status!: string;

  @ApiProperty({ description: 'How many rows hit this problem.' })
  count!: number;

  @ApiProperty({ type: [Number], description: 'Up to 10 example row numbers, ascending.' })
  row_numbers!: number[];

  @ApiProperty({ description: 'One verbatim example message.' })
  sample_issue!: string;
}

/** One cleaned + classified row from the dry run. */
export class ImportPreviewRowResponse {
  @ApiProperty()
  row_number!: number;

  @ApiProperty({ example: 'matched' })
  match_status!: string;

  @ApiProperty({ type: String, nullable: true })
  issue!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The row after mapping + cleaning.' })
  mapped_data!: Record<string, unknown>;
}

/** A product that would be created, identified by its client + catalogue type. */
export class ImportWillCreateProductResponse {
  @ApiProperty({ example: 'VF' })
  client_code!: string;

  @ApiProperty({ example: 'internet' })
  product_type!: string;
}

/**
 * The master data a HISTORICAL sales file references but that doesn't exist yet. Reported whether or not
 * `create_missing` is on: with it ON this is what WILL be created, with it OFF it is what is currently
 * blocking the rows.
 */
export class ImportWillCreateResponse {
  @ApiProperty({ type: [String], description: 'Client codes with no client record.' })
  clients!: string[];

  @ApiProperty({ type: [String], description: 'Rep codes with no rep record.' })
  reps!: string[];

  @ApiProperty({ type: () => [ImportWillCreateProductResponse] })
  products!: ImportWillCreateProductResponse[];
}

/**
 * The DRY RUN result: exactly what staging WOULD produce, with nothing written. Lets the operator fix the
 * sheet/mapping before a batch exists. — IMP-003
 */
export class ImportProductTypeColumnResponse {
  @ApiProperty({ example: 'Home Phone', description: 'The source column header.' })
  column!: string;

  @ApiProperty({ example: 'home_phone', description: 'The catalogue key it names.' })
  key!: string;
}

export class ImportPreviewResponse {
  @ApiProperty({ description: 'Whether this run was asked to create missing master data.' })
  create_missing!: boolean;

  @ApiProperty({ type: () => ImportWillCreateResponse })
  will_create!: ImportWillCreateResponse;

  @ApiProperty({
    type: () => [ImportProductTypeColumnResponse],
    description:
      'Non-empty when the file uses one yes/no COLUMN per product type instead of a single list cell. ' +
      'Each row’s products are read from these columns unless it has an explicit product-types value.',
  })
  product_type_columns!: ImportProductTypeColumnResponse[];
  @ApiProperty({ type: String, nullable: true, description: 'The worksheet chosen (null for CSV/TSV).' })
  sheet!: string | null;

  @ApiProperty({ type: [String], description: 'Every worksheet in the workbook, so the operator can pick another.' })
  sheets!: string[];

  @ApiProperty({ description: '1-based row the headers were detected on.' })
  header_row!: number;

  @ApiProperty({ type: [String] })
  headers!: string[];

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'The `{ systemField: sourceColumn }` mapping that would be applied.' })
  mapping!: Record<string, string>;

  @ApiProperty({ type: [String], description: 'Required system fields no column mapped to.' })
  unmapped_required!: string[];

  @ApiProperty()
  total_rows!: number;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, description: 'Row counts per match status.' })
  counts!: Record<string, number>;

  @ApiProperty({ type: () => [ImportIssueGroupResponse] })
  issue_groups!: ImportIssueGroupResponse[];

  @ApiProperty({ type: () => [ImportPreviewRowResponse], description: 'The first rows, cleaned + classified.' })
  sample!: ImportPreviewRowResponse[];
}

/** A saved reusable column→field mapping. */
export class ImportFieldMappingResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ImportSourceType })
  source_type!: ImportSourceType;

  @ApiProperty({ type: String, nullable: true })
  client_id!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  mapping_json!: Record<string, string>;

  @ApiProperty()
  created_by!: string;
}
