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

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Legacy / partner code (e.g. Redwave20). Imports resolve a rep by this OR rep_code.',
  })
  external_code!: string | null;

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

  // ── Profile (client request 2026-11-11). DOB / contact / address are NULLED unless hrm:edit. ──

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'PII — null unless hrm:edit.' })
  date_of_birth!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'PII — null unless hrm:edit.' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'PII — null unless hrm:edit.' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'PII — null unless hrm:edit.' })
  address_street!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'PII — null unless hrm:edit.' })
  address_city!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'PII — null unless hrm:edit.' })
  address_province!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'PII — null unless hrm:edit.' })
  address_postal!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'L' })
  jacket_size!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'M' })
  tshirt_size!: string | null;

  @ApiProperty({ description: 'Whether a SIN is on file. The SIN itself is never in this response.' })
  sin_on_file!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '••• ••• 286',
    description: 'Masked SIN (last 3 digits) — null unless hrm:edit. Use POST …/sin/reveal for the full value.',
  })
  sin_masked!: string | null;

  @ApiProperty({
    type: () => RepBankingResponse,
    nullable: true,
    description:
      "Direct-deposit banking, account MASKED. null unless hrm:edit (or the rep's own profile). " +
      'Reveal via POST /v1/reps/{id}/banking/reveal.',
  })
  banking!: RepBankingResponse | null;
}

/** Banking as a response carries it: routing codes + the MASKED account. Never the account itself. */
export class RepBankingResponse {
  @ApiProperty({ example: '001' })
  institution_no!: string;

  @ApiProperty({ type: String, nullable: true, example: '12345' })
  transit_no!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '••••4567' })
  account_masked!: string | null;
}

/** POST /v1/reps/{id}/banking/reveal (hrm:edit; every call audited). */
export class RevealAccountResponse {
  @ApiProperty({ type: String, nullable: true, example: '1234567' })
  account_no!: string | null;
}

/** A rep's OWN profile (GET /v1/account/rep-profile) — the rep view plus their field manager's name. */
export class MyRepProfileResponse extends RepResponse {
  @ApiProperty({ type: String, nullable: true, description: 'Your field manager (a rep cannot list users).' })
  field_manager_name!: string | null;
}

/** The decrypted SIN from POST /v1/reps/{id}/sin/reveal (hrm:edit; every call is audited). */
export class RevealSinResponse {
  @ApiProperty({ type: String, nullable: true, example: '046 454 286', description: 'null when no SIN is on file.' })
  sin!: string | null;
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

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: "When the document stops being valid (permits, PR card, driver's licence, passport).",
  })
  expires_on!: string | null;
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
