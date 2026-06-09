import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user: AuthUser = {
  id: 'u1', email: 'u@x.co', full_name: 'U', status: 'active',
  roleNames: [], isSuperAdmin: false, permissions: new Set(), repId: null,
};

function make() {
  const prisma = {
    notificationEventSetting: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'n1', is_read: true }),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationsService(prisma as never, audit as never, email as never);
  return { service, prisma, audit, email };
}

describe('NotificationsService.notify (RPT-009/010)', () => {
  it('creates an in-app notification when the event has in_app enabled; no email when email off', async () => {
    const { service, prisma, email } = make();
    prisma.notificationEventSetting.findUnique.mockResolvedValue({ in_app_enabled: true, email_enabled: false });
    await service.notify('signature_requested', 'recipient-1', { title: 'T', body: 'B' });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user_id: 'recipient-1', channel: 'in_app', is_read: false }) }),
    );
    expect(email.send).not.toHaveBeenCalled();
  });

  it('dispatches email (stub) only when the event has email enabled', async () => {
    const { service, prisma, email } = make();
    prisma.notificationEventSetting.findUnique.mockResolvedValue({ in_app_enabled: true, email_enabled: true });
    await service.notify('rate_change', 'u9', { title: 'T', body: 'B' });
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('an unknown event defaults to in-app only (safe default)', async () => {
    const { service, prisma, email } = make();
    prisma.notificationEventSetting.findUnique.mockResolvedValue(null);
    await service.notify('some_new_event', 'u9', { title: 'T', body: 'B' });
    expect(prisma.notification.create).toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('is best-effort — a create failure NEVER throws to the caller', async () => {
    const { service, prisma } = make();
    prisma.notificationEventSetting.findUnique.mockResolvedValue({ in_app_enabled: true, email_enabled: false });
    prisma.notification.create.mockRejectedValue(new Error('db down'));
    await expect(service.notify('x', 'u9', { title: 'T', body: 'B' })).resolves.toBeUndefined();
  });
});

describe('NotificationsService own-scope + settings', () => {
  it('listOwn filters to the caller’s own user_id', async () => {
    const { service, prisma } = make();
    await service.listOwn(user, {});
    expect((prisma.notification.findMany.mock.calls[0][0] as { where: { user_id: string } }).where.user_id).toBe('u1');
  });

  it('setReadState refuses another user’s notification (404)', async () => {
    const { service, prisma } = make();
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.setReadState('n-other', user, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listOwn returns a paginated {data,meta} page scoped to the caller', async () => {
    const { service } = make();
    const page = await service.listOwn(user, {});
    expect(page).toEqual({ data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 0 } });
  });

  it('bulkMark is own-scoped (updateMany where includes user_id) and returns the updated count', async () => {
    const { service, prisma } = make();
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const res = await service.bulkMark(user, ['a', 'b'], true);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ user_id: 'u1' }) }),
    );
    expect(res).toEqual({ updated: 3 });
  });

  it('updateSettings upserts each event (global — no per-user override) and audits', async () => {
    const { service, prisma, audit } = make();
    await service.updateSettings({ settings: [{ event_type: 'rate_change', in_app_enabled: true, email_enabled: false }] }, {
      ...user,
      isSuperAdmin: true,
    });
    expect(prisma.notificationEventSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { event_type: 'rate_change' } }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'edit' }));
  });
});
