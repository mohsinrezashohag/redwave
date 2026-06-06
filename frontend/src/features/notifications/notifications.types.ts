/**
 * Notification types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/reporting/dto/reporting.response.ts`.
 * The list is own-only (scoped server-side by user_id). REQUEST body typed from the schema.
 */
import type { components } from '../../api/generated/schema';

export type NotificationChannel = components['schemas']['AppNotificationResponse']['channel'];

export type AppNotification = components['schemas']['AppNotificationResponse'];

export interface NotificationFilter {
  is_read?: boolean;
}

/**
 * A global per-event channel setting (GET /v1/notification-settings, settings:view / Super Admin). There
 * is NO per-user override — the Super Admin configures channels per event for everyone (SRS AUTH-013).
 */
export type NotificationSetting = components['schemas']['NotificationSettingResponse'];

// Request body for the settings editor (PATCH /v1/notification-settings, settings:edit). Typed from schema.
export type UpdateNotificationSettingsBody = components['schemas']['UpdateNotificationSettingsDto'];
