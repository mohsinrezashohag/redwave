/**
 * Notification controllers — /v1/notifications and /v1/notification-settings. — arch §6.12
 * The list/read endpoints are authenticated-only and scoped to the caller's OWN notifications. The
 * per-event settings are Super-Admin-gated via the `settings` permission (only Super Admin holds it).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQuery } from './dto/list-notifications.query';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { AppNotificationResponse, NotificationSettingResponse } from './dto/reporting.response';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications', description: 'Authenticated; returns only the caller’s own notifications.' })
  @ApiOkResponse({ type: AppNotificationResponse, isArray: true })
  list(@Query() query: ListNotificationsQuery, @CurrentUser() user: AuthUser) {
    return this.notifications.listOwn(user, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification read', description: 'Authenticated; only the caller’s own notification.' })
  @ApiOkResponse({ type: AppNotificationResponse })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(id, user);
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
