-- Notification event templates + the `broadcast` RBAC action. Non-destructive (ADD COLUMN / ADD VALUE).
-- Hand-authored so it applies with `prisma migrate deploy` without a shadow database. On PostgreSQL 12+
-- (Supabase is 15) `ALTER TYPE ... ADD VALUE` is allowed inside the migration's transaction because the new
-- value is NOT used here — the (notifications, broadcast) permission row is seeded by bootstrap, separately.

-- 1) Super-Admin-editable templates on the event catalogue (nullable; existing rows keep call-site text).
ALTER TABLE "notification_event_settings" ADD COLUMN "label" VARCHAR(120);
ALTER TABLE "notification_event_settings" ADD COLUMN "title_template" VARCHAR(200);
ALTER TABLE "notification_event_settings" ADD COLUMN "body_template" VARCHAR(1000);

-- 2) The one off-grid permission action (gates the manual broadcast).
ALTER TYPE "PermissionAction" ADD VALUE 'broadcast';
