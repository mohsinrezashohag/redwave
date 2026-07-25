import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportSourceType, ImportType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Create a staged import batch from an uploaded file. — SRS §15 (IMP-003/011)
 * Multipart: the Excel/CSV `file` + these metadata form fields. The server parses, cleans, auto-maps
 * (or applies `field_mapping_id`), classifies, and stages — nothing touches live tables until commit.
 * `reconcile_total` is the OPERATOR-PROVIDED source total used to gate a balance migration (IMP-007).
 */
export class CreateImportDto {
  @ApiProperty({ enum: ImportSourceType, example: 'client_report' })
  @IsEnum(ImportSourceType)
  source_type!: ImportSourceType;

  @ApiProperty({ enum: ImportType, example: 'sales' })
  @IsEnum(ImportType)
  import_type!: ImportType;

  @ApiPropertyOptional({ description: 'Client scope (required for client_report).' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ description: 'A saved field mapping to apply (else the server auto-suggests one).' })
  @IsOptional()
  @IsUUID()
  field_mapping_id?: string;

  @ApiPropertyOptional({
    example: 'Historical Sales',
    description:
      'Worksheet to read (Excel only, case-insensitive). Omit to let the server pick the sheet whose headers best match this target — useful when the workbook also carries an Instructions or Summary tab.',
  })
  @IsOptional()
  @IsString()
  sheet?: string;

  /**
   * Opt in to creating the master data a HISTORICAL sales row references but that doesn't exist yet —
   * the client, the rep, or the client's product for a type. Default OFF: inventing master data is a
   * deliberate act, so the operator must ask for it after seeing exactly what the preview says will be
   * created. Rejected (422) on any other target — most importantly LIVE sales, where an invented rep or
   * product would flow straight into the commission engine.
   */
  @ApiPropertyOptional({
    example: false,
    description:
      'HISTORICAL sales only. Create the referenced client / rep / product when it does not exist yet, ' +
      'instead of erroring the row. Preview first — it lists exactly what would be created. Never ' +
      'allowed for live sales entry.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  create_missing?: boolean;

  @ApiPropertyOptional({
    example: '48200.00',
    description: 'Operator-provided source total (required to commit a balance migration). Decimal string.',
  })
  @IsOptional()
  @Matches(MONEY, { message: 'reconcile_total must be a decimal string with up to 2 decimal places' })
  reconcile_total?: string;
}
