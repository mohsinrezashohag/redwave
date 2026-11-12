import { ApiProperty } from '@nestjs/swagger';
import { PageMetaResponse } from '../../../common/pagination/page.response';

export class AuditActorResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  full_name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: String, nullable: true, description: "The actor's photo, short-lived URL." })
  avatar_url!: string | null;
}

export class AuditLogResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  user_id!: string;

  @ApiProperty({ type: () => AuditActorResponse, nullable: true, description: 'The acting user (name + email).' })
  actor!: AuditActorResponse | null;

  @ApiProperty()
  entity_type!: string;

  @ApiProperty()
  entity_id!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Pre-mutation state.' })
  before_json!: Record<string, unknown> | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Post-mutation state.' })
  after_json!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true, description: 'Actor IP at the time of the action.' })
  ip_address!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

export class AuditLogPageResponse {
  @ApiProperty({ type: () => [AuditLogResponse] })
  data!: AuditLogResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}
