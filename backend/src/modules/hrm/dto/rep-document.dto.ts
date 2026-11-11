import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
}
