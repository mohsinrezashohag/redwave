import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Create a document. — SRS DOC-001
 * The PDF arrives through the unified upload pipeline (`POST /v1/files`, purpose=document); this create
 * CLAIMS that stored path (must exist + be the caller's own upload, PDF mime — else 422) and freezes it
 * as the immutable original (DOC-001/004).
 */
export class CreateDocumentDto {
  @ApiProperty({ example: 'Compensation Agreement 2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: DocumentType, example: 'compensation_agreement' })
  @IsEnum(DocumentType)
  doc_type!: DocumentType;

  @ApiProperty({
    example: 'documents/2026/06/3f2a….pdf',
    description: 'The stored_files path returned by POST /v1/files (purpose=document). Claim-validated.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  file_path!: string;
}
