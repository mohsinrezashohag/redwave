/**
 * Clients & Products response DTOs — the billing-stream config the controllers return. — Batch A #2
 * `BillingRateResponse.amount` is a money STRING (#1) + carries the server-derived effective-dating `status`.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Market, RateKind } from '@prisma/client';
import { PageMetaResponse } from '../../../common/pagination/page.response';

const RATE_STATUS = ['current', 'pending', 'past'] as const;
type RateStatus = (typeof RATE_STATUS)[number];

export class ClientCustomFieldResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Account manager' })
  field_name!: string;

  @ApiProperty({ example: 'Jane Smith' })
  field_value!: string;

  @ApiProperty({ example: 0 })
  display_order!: number;
}

export class ClientResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'VF' })
  client_code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: Market })
  market!: Market;

  @ApiProperty({ example: 'CAD', description: 'Billing currency (ISO 4217). All billing rates/documents are in it; rolls up to CAD via frozen FX (#12).' })
  currency!: string;

  @ApiProperty()
  supplies_mpu_id!: boolean;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiPropertyOptional({ type: () => [ClientCustomFieldResponse], description: 'Present on the detail GET.' })
  custom_fields?: ClientCustomFieldResponse[];
}

export class ProductResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, example: 'internet', description: 'Product-type catalogue key.' })
  product_type!: string;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

/** Paginated list envelope (arch §5.1) — one page of clients + the meta. */
export class ClientPageResponse {
  @ApiProperty({ type: () => [ClientResponse] })
  data!: ClientResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

/** Paginated list envelope (arch §5.1) — one page of products (cross-client) + the meta. */
export class ProductPageResponse {
  @ApiProperty({ type: () => [ProductResponse] })
  data!: ProductResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

export class BillingRateResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  client_id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'null for client-wide add-on kinds.' })
  product_id!: string | null;

  @ApiProperty({ enum: RateKind })
  rate_kind!: RateKind;

  @ApiProperty({ type: [String], example: ['home_phone', 'tv'], description: 'bundle_bonus trigger product types (sorted); empty for other kinds.' })
  bundle_product_types!: string[];

  @ApiProperty({ type: String, example: '50.00', description: 'Decimal string — what we charge the client.' })
  amount!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  effective_from!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  effective_to!: string | null;

  @ApiProperty()
  created_by!: string;

  @ApiProperty({ enum: RATE_STATUS })
  status!: RateStatus;
}
