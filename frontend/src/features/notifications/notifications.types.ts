/**
 * Notification types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/reporting/dto/reporting.response.ts`.
 * The list is own-only (scoped server-side by user_id). REQUEST body typed from the schema.
 */
import type { components } from '../../api/generated/schema';

export type NotificationChannel = components['schemas']['AppNotificationResponse']['channel'];

export type AppNotification = components['schemas']['AppNotificationResponse'];

/** The paginated /v1/notifications envelope ({ data, meta }). */
export type NotificationPage = components['schemas']['NotificationPageResponse'];

export interface NotificationFilter {
  is_read?: boolean;
}

export interface NotificationsFilters {
  is_read?: boolean;
  search?: string;
}

/** Server-side list params: filters + pagination/sort (page is 1-based). */
export interface NotificationListParams extends NotificationsFilters {
  page: number;
  limit: number;
  sort?: string;
}

/** Manual broadcast request body (notifications:broadcast / Super Admin). */
export type BroadcastBody = components['schemas']['BroadcastDto'];

/**
 * A global per-event channel setting (GET /v1/notification-settings, settings:view / Super Admin). There
 * is NO per-user override — the Super Admin configures channels per event for everyone (SRS AUTH-013).
 */
export type NotificationSetting = components['schemas']['NotificationSettingResponse'];

// Request body for the settings editor (PATCH /v1/notification-settings, settings:edit). Typed from schema.
export type UpdateNotificationSettingsBody = components['schemas']['UpdateNotificationSettingsDto'];
