import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

/** Filters for the document list. Results are always visibility-scoped in the query (§5). */
export class ListDocumentsQuery {
  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  doc_type?: DocumentType;

  @ApiPropertyOptional({ description: 'Only documents with at least one PENDING signature request (the ops queue).' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pending_signatures?: boolean;

  @ApiPropertyOptional({
    description:
      "Only documents where the CALLER has a pending signature in a pending request (the 'to sign' inbox). Row-level: always the caller's own signatures, even for an admin.",
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  awaiting_my_signature?: boolean;
}
