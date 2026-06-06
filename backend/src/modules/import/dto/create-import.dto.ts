import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportSourceType, ImportType } from '@prisma/client';
import { ArrayMinSize, IsArray, IsEnum, IsObject, IsOptional, IsUUID, Matches } from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Create a staged import batch. — SRS §15 (IMP-003)
 * The binary file upload is STUBBED: rows are fed directly as raw JSON objects (the parse/mapping
 * logic is real + tested). `reconcile_total` is the OPERATOR-PROVIDED source total used to gate a
 * balance migration (IMP-007).
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

  @ApiPropertyOptional({ description: 'A saved field mapping to apply to each row.' })
  @IsOptional()
  @IsUUID()
  field_mapping_id?: string;

  @ApiPropertyOptional({
    example: '48200.00',
    description: 'Operator-provided source total (required to commit a balance migration). Decimal string.',
  })
  @IsOptional()
  @Matches(MONEY, { message: 'reconcile_total must be a decimal string with up to 2 decimal places' })
  reconcile_total?: string;

  // Explicit array-of-free-form-object schema so swagger does NOT degrade `rows` to `Record<string,never>`
  // (the documented quirk) — lets the frontend use the generated request DTO directly. — Batch A #2
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Raw source rows (file upload stubbed). Each is an arbitrary key→value object.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsObject({ each: true })
  rows!: Record<string, unknown>[];
}
