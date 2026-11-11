/**
 * "Tiers OFF" for one scope (Global or one client): every internet activation pays a BASE PRICE — the
 * product's own price where one is set, else the scope's default. — client request 2026-11-11
 *
 * Stored on today's model, so the engine is untouched: a single [0, ∞) tier-1 bracket at `default_rate`,
 * plus a tier-1 per-product rate for each priced product. See BasePricesService.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BasePriceDto {
  @ApiProperty({ description: "A TIERED (internet) product of the scope's client." })
  @IsUUID()
  product_id!: string;

  @ApiProperty({ example: '160.00', description: 'Base price per activation — decimal string (#1).' })
  @IsString()
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount!: string;
}

export class SetBasePricesDto {
  @ApiPropertyOptional({
    description:
      'The client whose prices these are. OMIT for the GLOBAL default (followed by every client without its own ' +
      'setting). Global accepts a default price only — per-product prices are set per client.',
  })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiProperty({ example: '2026-11-22', description: 'YYYY-MM-DD; today or later (#10).' })
  @Matches(DATE, { message: 'effective_from must be a YYYY-MM-DD date' })
  effective_from!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @Matches(DATE, { message: 'effective_to must be a YYYY-MM-DD date' })
  effective_to?: string;

  @ApiProperty({
    example: '145.00',
    description: 'The price for any internet product in this scope WITHOUT its own price below.',
  })
  @IsString()
  @Matches(MONEY, { message: 'default_rate must be a decimal string with up to 2 decimal places' })
  default_rate!: string;

  @ApiProperty({ type: () => [BasePriceDto], description: "Per-product prices (client scope only). Omitted products use the default." })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BasePriceDto)
  prices!: BasePriceDto[];
}
