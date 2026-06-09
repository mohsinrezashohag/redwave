/**
 * Global-search response DTOs — grouped, minimal results with the ids needed to deep-link. No money,
 * no scope-bypassing data; each group is only populated when the caller is entitled to it (see the service).
 */
import { ApiProperty } from '@nestjs/swagger';

export class SearchRepResult {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'RW-D-0001' }) rep_code!: string;
  @ApiProperty() full_name!: string;
}

export class SearchClientResult {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'VF' }) client_code!: string;
  @ApiProperty() name!: string;
}

export class SearchSaleResult {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '2026-01-10-VF' }) sale_code!: string;
  @ApiProperty() customer_name!: string;
}

export class SearchResponse {
  @ApiProperty({ type: () => [SearchRepResult] }) reps!: SearchRepResult[];
  @ApiProperty({ type: () => [SearchClientResult] }) clients!: SearchClientResult[];
  @ApiProperty({ type: () => [SearchSaleResult] }) sales!: SearchSaleResult[];
}
