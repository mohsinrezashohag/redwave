/**
 * Unified upload DTOs — POST /v1/files (multipart). The client sends ONLY the bytes + an optional
 * display name + the purpose; the object path is SERVER-generated (stored-files.logic). The response is
 * the stored_files row — deliberately NO signed URL (downloads go through the per-domain RBAC-gated
 * …-url endpoints).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FILE_PURPOSES, FilePurpose } from '../stored-files.logic';

export class CreateFileDto {
  @ApiProperty({ enum: FILE_PURPOSES, description: 'What the file is for — shapes the storage path prefix.' })
  @IsIn(FILE_PURPOSES)
  purpose!: FilePurpose;

  @ApiPropertyOptional({ maxLength: 200, description: 'Human-friendly name shown in the UI (defaults to none).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  display_name?: string;
}

export class StoredFileResponse {
  @ApiProperty() id!: string;
  @ApiProperty() bucket!: string;
  @ApiProperty({ description: 'The server-generated object path — what consumers store and later claim.' })
  path!: string;
  @ApiProperty() original_name!: string;
  @ApiProperty({ type: String, nullable: true }) display_name!: string | null;
  @ApiProperty() mime!: string;
  @ApiProperty() size_bytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty() uploaded_by!: string;
  @ApiProperty({ type: String, format: 'date-time' }) created_at!: string;
}
