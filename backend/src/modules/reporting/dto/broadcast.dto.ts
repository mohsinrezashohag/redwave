/**
 * Broadcast DTO — the Super Admin composes an ad-hoc notification (title + body) and targets an audience:
 * a role, a specific set of users, or everyone. Fans out to the targeted users' notifications (+ email
 * where the `broadcast` event's channel is on). Gated by `notifications:broadcast`. — SRS §14
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class BroadcastAudienceDto {
  @ApiProperty({ enum: ['role', 'users', 'all'] })
  @IsIn(['role', 'users', 'all'])
  kind!: 'role' | 'users' | 'all';

  @ApiPropertyOptional({ description: "Required when kind='role' (a role name, e.g. 'Manager')." })
  @ValidateIf((o) => o.kind === 'role')
  @IsString()
  @MaxLength(60)
  role?: string;

  @ApiPropertyOptional({ type: [String], description: "Required when kind='users'." })
  @ValidateIf((o) => o.kind === 'users')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  userIds?: string[];
}

export class BroadcastDto {
  @ApiProperty({ example: 'System maintenance tonight' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiProperty({ example: 'The platform will be briefly unavailable at 10pm CT.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiProperty({ type: () => BroadcastAudienceDto })
  @ValidateNested()
  @Type(() => BroadcastAudienceDto)
  audience!: BroadcastAudienceDto;
}
