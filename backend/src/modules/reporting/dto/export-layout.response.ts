import { ApiProperty } from '@nestjs/swagger';

export class ExportLayoutColumnResponse {
  @ApiProperty({ example: 'internet_rate' })
  field!: string;

  @ApiProperty({ type: String, required: false, example: 'Internet Rate' })
  header?: string;
}

export class ExportLayoutResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'payroll' })
  report_type!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Null = the report-wide layout.' })
  client_id!: string | null;

  @ApiProperty({ type: [ExportLayoutColumnResponse] })
  columns!: ExportLayoutColumnResponse[];

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty()
  created_by!: string;
}

export class ExportFieldResponse {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Summed by the workbook’s SUBTOTAL strip where one exists.' })
  money!: boolean;

  @ApiProperty({ description: 'Cannot be removed — the formulas or the row’s identity depend on it.' })
  required!: boolean;
}

export class ExportRegistryEntryResponse {
  @ApiProperty({ example: 'payroll' })
  report_type!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    description:
      'True when a live SUBTOTAL strip constrains the layout — money columns must then stay contiguous.',
  })
  has_formula_strip!: boolean;

  @ApiProperty({ type: [ExportFieldResponse] })
  fields!: ExportFieldResponse[];

  @ApiProperty({ type: [ExportLayoutColumnResponse] })
  default_columns!: ExportLayoutColumnResponse[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'A sample row — the export analogue of an import template.',
  })
  sample_row!: Record<string, string>;
}
