import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination.query';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Optional initial CLIENT-BILLING rate (rate_kind 'product') set when creating a product. — #3 billing stream */
export class InitialBillingRateDto {
  @ApiProperty({ example: '49.99', description: 'Exact decimal STRING (≤2 dp). Never a float.' })
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount!: string;

  @ApiProperty({ example: '2026-07-01', description: 'YYYY-MM-DD; must be today or future.' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Fibre 1gig' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  // product_type is a key into the product-type catalogue (existence + active checked in the service).
  @ApiProperty({ example: 'internet', description: 'Product-type catalogue key.' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'product_type must be a lowercase snake_case catalogue key' })
  product_type!: string;

  @ApiPropertyOptional({
    type: InitialBillingRateDto,
    description: 'Optional initial client-billing rate. Requires billing_rates:create.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialBillingRateDto)
  initial_billing_rate?: InitialBillingRateDto;
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

  @ApiPropertyOptional({ description: 'Filter by product-type catalogue key.' })
  @IsOptional()
  @IsString()
  product_type?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}
