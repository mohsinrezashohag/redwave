/**
 * HRM response DTOs — reps, rep documents, equipment. — Batch A #2
 *
 * PII redaction (#5): `payment_details` (rep) and `file_url` (document) are NULLED in the response unless
 * the caller has `hrm:edit` — so both are nullable here. `payment_details` is a free-form JSON blob →
 * `additionalProperties:true` (never `Record<string,never>`). `deposit_amount` is a money STRING (#1).
 */
import { ApiProperty } from '@nestjs/swagger';
import { EquipmentStatus, RepStatus } from '@prisma/client';
import { PageMetaResponse } from '../../../common/pagination/page.response';

export class RepResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  rep_code!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Linked login user, if any.' })
  user_id!: string | null;

  @ApiProperty()
  full_name!: string;

  @ApiProperty()
  field_manager_id!: string;

  @ApiProperty({ enum: RepStatus })
  status!: RepStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  hire_date!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  termination_date!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Sensitive payment info — NULLED unless the caller has hrm:edit.',
  })
  payment_details!: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

/** Paginated list envelope (arch §5.1) — one page of reps + the meta. */
export class RepPageResponse {
  @ApiProperty({ type: () => [RepResponse] })
  data!: RepResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

export class RepDocumentResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty()
  doc_type!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Storage reference — NULLED unless the caller has hrm:edit.' })
  file_url!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  uploaded_at!: string;
}

export class RepEquipmentResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty()
  equipment_type!: string;

  @ApiProperty()
  identifier!: string;

  @ApiProperty({ type: String, example: '250.00', description: 'Decimal string — the deposit held.' })
  deposit_amount!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  assigned_date!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  returned_date!: string | null;

  @ApiProperty({ enum: EquipmentStatus })
  status!: EquipmentStatus;
}
