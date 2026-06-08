import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

export class CreateProductDto {
  @ApiProperty({ example: 'Fibre 1gig' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  product_type!: ProductType;
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  // product_type is intentionally immutable after creation (sale_items & rates reference it).

  @ApiPropertyOptional({ description: 'Set false to deactivate (soft — history preserved).' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ListProductsQuery {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

/**
 * Cross-client product list (GET /v1/products) — paginated. Filters client_id/product_type/status + name
 * search. sort allowlist: name/product_type/is_active/created_at.
 */
export class ListAllProductsQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Filter to one client.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}
