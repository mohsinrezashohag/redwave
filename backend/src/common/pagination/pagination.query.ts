/**
 * PaginationQuery — the shared list-contract query params (arch §5.1). Feature list DTOs EXTEND this to
 * gain `?page=&limit=&sort=field:dir&search=` on top of their own filters. 1-based page; limit clamped
 * 1..100 (default 20). `sort` is validated only for shape here — the per-entity allowlist (the real guard
 * against orderBy injection) lives in `resolveOrderBy`.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class PaginationQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: '1-based page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Rows per page (max 100).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Sort as `field:dir` (e.g. `sale_date:desc`). Unknown fields fall back to the default sort.',
    example: 'sale_date:desc',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]+:(asc|desc)$/, { message: 'sort must be `field:asc` or `field:desc`' })
  sort?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive free-text search across the entity’s key columns.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
