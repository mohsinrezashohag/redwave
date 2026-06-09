/**
 * Notification controllers — /v1/notifications and /v1/notification-settings. — arch §6.12
 * The list/read endpoints are authenticated-only and scoped to the caller's OWN notifications. The
 * per-event settings are Super-Admin-gated via the `settings` permission (only Super Admin holds it).
 */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQuery } from './dto/list-notifications.query';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { MarkNotificationDto, BulkMarkDto } from './dto/mark-notifications.dto';
import { BroadcastDto } from './dto/broadcast.dto';
import { AppNotificationResponse, NotificationSettingResponse } from './dto/reporting.response';
import {
  BroadcastResultResponse,
  BulkMarkResultResponse,
  NotificationPageResponse,
  UnreadCountResponse,
} from './dto/notification.response';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications',
    description: 'Authenticated; only the caller’s own. Paginated (page/limit/sort/search) + is_read filter.',
  })
  @ApiOkResponse({ type: NotificationPageResponse })
  list(@Query() query: ListNotificationsQuery, @CurrentUser() user: AuthUser) {
    return this.notifications.listOwn(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'My unread count', description: 'Authenticated; for the top-bar bell badge (polled).' })
  @ApiOkResponse({ type: UnreadCountResponse })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('mark-all-read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all read', description: 'Authenticated; marks all the caller’s unread notifications read.' })
  @ApiOkResponse({ type: BulkMarkResultResponse })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Post('mark-read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk mark read/unread', description: 'Authenticated; own-scoped bulk toggle.' })
  @ApiOkResponse({ type: BulkMarkResultResponse })
  bulkMark(@Body() dto: BulkMarkDto, @CurrentUser() user: AuthUser) {
    return this.notifications.bulkMark(user, dto.ids, dto.read);
  }

  @Post('broadcast')
  @RequirePermission('notifications', 'broadcast')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a manual broadcast',
    description: 'Requires notifications:broadcast (Super Admin). Fans out to a role / specific users / everyone.',
  })
  @ApiOkResponse({ type: BroadcastResultResponse })
  broadcast(@Body() dto: BroadcastDto, @CurrentUser() user: AuthUser) {
    return this.notifications.broadcast(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mark a notification read/unread', description: 'Authenticated; only the caller’s own.' })
  @ApiOkResponse({ type: AppNotificationResponse })
  setReadState(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkNotificationDto, @CurrentUser() user: AuthUser) {
    return this.notifications.setReadState(id, user, dto.is_read);
  }
}

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'Notification event settings', description: 'Requires settings:view (Super Admin).' })
  @ApiOkResponse({ type: NotificationSettingResponse, isArray: true })
  list() {
    return this.notifications.listSettings();
  }

  @Patch()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Configure event×channel settings',
    description: 'Requires settings:edit (Super Admin). Per-event in-app/email toggles; NO per-user override.',
  })
  @ApiOkResponse({ type: NotificationSettingResponse, isArray: true })
  update(@Body() dto: UpdateNotificationSettingsDto, @CurrentUser() user: AuthUser) {
    return this.notifications.updateSettings(dto, user);
  }
}
