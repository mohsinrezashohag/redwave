import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * A rep document is uploaded as multipart (the file) + metadata. The file is stored to object storage
 * (the row keeps the object PATH, served via /file-url); sensitive file refs are gated on hrm:edit. — arch §11
 * The type must be one of REP_DOC_TYPES (rep-documents.logic, 2026-11-12); the controller checks the
 * kind-specific rules (headshot = JPG/PNG, expiry only on expiring documents).
 */
export class CreateRepDocumentDto {
  @ApiProperty({
    example: 'passport',
    description: 'banking | headshot | work_permit | study_permit | pr_card | drivers_licence | passport | contract | other',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  doc_type!: string;

  @ApiPropertyOptional({
    example: '2027-06-30',
    description: "YYYY-MM-DD. Permits, PR card, driver's licence and passport only.",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expires_on must be a YYYY-MM-DD date' })
  expires_on?: string;

  @ApiPropertyOptional({
    example: '2022-06-30',
    description: "YYYY-MM-DD issue date. Permits, PR card, driver's licence and passport only (2026-11-12).",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issued_on must be a YYYY-MM-DD date' })
  issued_on?: string;
}

/** What kind of document is being read, so the reader knows what to look for. */
export class ReadRepDocumentDto {
  @ApiProperty({ example: 'passport' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  doc_type!: string;
}

/**
 * Edit a document on file (2026-11-12): its type and, for IDs, its issue/expiry dates. `null` clears a date;
 * an omitted field is left as it is. Changing to a type without dates clears them. The kind-specific rules
 * (headshot = JPG/PNG, dates only on IDs, issue before expiry) are re-checked by the service.
 */
export class UpdateRepDocumentDto {
  @ApiPropertyOptional({ example: 'passport', description: 'One of the document types; omitted = unchanged.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  doc_type?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2022-06-30' })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issued_on must be a YYYY-MM-DD date' })
  issued_on?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2032-06-30' })
  @IsOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expires_on must be a YYYY-MM-DD date' })
  expires_on?: string | null;
}

/**
 * Replace a document's file (multipart `file` + these fields). The new file becomes the live document with the
 * same type; the old one moves to Recently deleted, restorable for 30 days. Omitted dates carry over. — 2026-11-12
 */
export class ReplaceRepDocumentDto {
  @ApiPropertyOptional({ example: '2032-06-30', description: 'YYYY-MM-DD; omitted = keep the current date.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expires_on must be a YYYY-MM-DD date' })
  expires_on?: string;

  @ApiPropertyOptional({ example: '2022-06-30', description: 'YYYY-MM-DD; omitted = keep the current date.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'issued_on must be a YYYY-MM-DD date' })
  issued_on?: string;
}
