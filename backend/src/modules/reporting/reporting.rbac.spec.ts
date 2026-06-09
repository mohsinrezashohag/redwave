import 'reflect-metadata';
import { DashboardsController, LeaderboardController } from './dashboards.controller';
import { NotificationsController, NotificationSettingsController } from './notifications.controller';
import { ChatbotController } from './chatbot.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Reporting RBAC metadata — arch §6.12', () => {
  it('rep dashboard is authenticated-only (scoped in the service); others require reports:view', () => {
    expect(meta(DashboardsController, 'rep')).toBeUndefined(); // "self" — no permission, scoped to repId
    expect(meta(DashboardsController, 'manager')).toEqual({ moduleKey: 'reports', action: 'view' });
    expect(meta(DashboardsController, 'business')).toEqual({ moduleKey: 'reports', action: 'view' });
    expect(meta(DashboardsController, 'admin')).toEqual({ moduleKey: 'reports', action: 'view' });
    expect(meta(LeaderboardController, 'list')).toEqual({ moduleKey: 'reports', action: 'view' });
  });

  it('notification reads/mark are authenticated-only (own); broadcast needs notifications:broadcast; settings need settings:* (SA)', () => {
    expect(meta(NotificationsController, 'list')).toBeUndefined();
    expect(meta(NotificationsController, 'unreadCount')).toBeUndefined();
    expect(meta(NotificationsController, 'setReadState')).toBeUndefined();
    expect(meta(NotificationsController, 'markAllRead')).toBeUndefined();
    expect(meta(NotificationsController, 'bulkMark')).toBeUndefined();
    expect(meta(NotificationsController, 'broadcast')).toEqual({ moduleKey: 'notifications', action: 'broadcast' });
    expect(meta(NotificationSettingsController, 'list')).toEqual({ moduleKey: 'settings', action: 'view' });
    expect(meta(NotificationSettingsController, 'update')).toEqual({ moduleKey: 'settings', action: 'edit' });
  });

  it('chatbot is authenticated-only (scope enforced in the tool layer)', () => {
    expect(meta(ChatbotController, 'query')).toBeUndefined();
  });
});
