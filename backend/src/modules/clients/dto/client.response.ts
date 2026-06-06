/**
 * Clients & Products response DTOs — the billing-stream config the controllers return. — Batch A #2
 * `BillingRateResponse.amount` is a money STRING (#1) + carries the server-derived effective-dating `status`.
 */
import { ApiProperty } from '@nestjs/swagger';
import { Market, ProductType, RateKind } from '@prisma/client';

const RATE_STATUS = ['current', 'pending', 'past'] as const;
type RateStatus = (typeof RATE_STATUS)[number];

export class ClientResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'VF' })
  client_code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: Market })
  market!: Market;

  @ApiProperty()
  supplies_mpu_id!: boolean;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

export class ProductResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProductType })
  product_type!: ProductType;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
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
