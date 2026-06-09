/**
 * Notification list/action response DTOs — the paginated envelope (arch §5.1) + the small action results.
 */
import { ApiProperty } from '@nestjs/swagger';
import { PageMetaResponse } from '../../../common/pagination/page.response';
import { AppNotificationResponse } from './reporting.response';

export class NotificationPageResponse {
  @ApiProperty({ type: () => [AppNotificationResponse] })
  data!: AppNotificationResponse[];

  @ApiProperty({ type: () => PageMetaResponse })
  meta!: PageMetaResponse;
}

export class UnreadCountResponse {
  @ApiProperty({ example: 7, description: "The caller's unread notification count." })
  count!: number;
}

export class BulkMarkResultResponse {
  @ApiProperty({ example: 5, description: 'Rows updated (own-scoped; non-owned ids are ignored).' })
  updated!: number;
}

export class BroadcastResultResponse {
  @ApiProperty({ example: 12, description: 'Number of active users the broadcast reached.' })
  recipients!: number;
}
