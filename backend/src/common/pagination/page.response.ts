/**
 * PageMetaResponse — the `meta` block of every paginated list response (arch §5.1). Per-entity
 * `*PageResponse` DTOs reference it via `@ApiProperty({ type: () => PageMetaResponse })` so the OpenAPI
 * contract documents the envelope and the frontend aliases it.
 */
import { ApiProperty } from '@nestjs/swagger';

export class PageMetaResponse {
  @ApiProperty({ example: 137, description: 'Total rows matching the filters (across all pages).' })
  total!: number;

  @ApiProperty({ example: 1, description: '1-based current page.' })
  page!: number;

  @ApiProperty({ example: 20, description: 'Rows per page used for this response.' })
  limit!: number;

  @ApiProperty({ example: 7, description: 'Total pages (0 when there are no rows).' })
  pageCount!: number;
}
