/**
 * Mark read/unread DTOs — a single notification toggle + a bulk toggle. All own-scoped in the service.
 */
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsUUID } from 'class-validator';

export class MarkNotificationDto {
  @ApiProperty({ description: 'Mark read (true) or unread (false).' })
  @IsBoolean()
  is_read!: boolean;
}

export class BulkMarkDto {
  @ApiProperty({ type: [String], description: 'Notification ids to update (own-scoped).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({ description: 'Mark the selected notifications read (true) or unread (false).' })
  @IsBoolean()
  read!: boolean;
}
