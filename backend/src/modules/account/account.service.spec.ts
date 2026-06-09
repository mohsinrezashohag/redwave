import { AccountService } from './account.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const reviewer: AuthUser = {
  id: 'rev-1',
  email: 'rev@x.co',
  full_name: 'Reviewer',
  status: 'active',
  roleNames: ['Super Admin'],
  isSuperAdmin: true,
  permissions: new Set(['profile:approve']),
  repId: null,
};

const self: AuthUser = {
  id: 'u1',
  email: 'u1@x.co',
  full_name: 'User One',
  status: 'active',
  roleNames: ['Sales Rep'],
  isSuperAdmin: false,
  permissions: new Set(),
  repId: 'rep-1',
};

function makeService() {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    profileChangeRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = {
    canReviewRequest: jest.fn().mockResolvedValue(true),
    profileReviewWhere: jest.fn(),
    reviewerUserIds: jest.fn().mockResolvedValue([]),
  };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const service = new AccountService(prisma as never, audit as never, scope as never, emitter as never);
  return { service, prisma, audit, scope };
}

describe('AccountService — profile changes (AUTH-010 / AUTH-011, §4.4)', () => {
  it('theme change writes to the user immediately (no review)', async () => {
    const { service, prisma } = makeService();
    prisma.user.update.mockResolvedValue({ id: 'u1', theme_preference: 'dark' });

    await service.setTheme(self, { theme_preference: 'dark' as never });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { theme_preference: 'dark' } }),
    );
  });

  it('an HR-field edit creates a PENDING request and does NOT touch the live profile', async () => {
    const { service, prisma } = makeService();
    prisma.profileChangeRequest.create.mockResolvedValue({
      id: 'req-1',
      status: 'pending',
      proposed_changes: { phone: '555-1234' },
      created_at: new Date(0),
    });

    await service.requestProfileChange(self, { phone: '555-1234' });

    expect(prisma.profileChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'u1',
          requested_by: 'u1',
          status: 'pending',
          proposed_changes: { phone: '555-1234' },
        }),
      }),
    );
    // The crux of AUTH-011: the live user record is untouched until approval.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an empty profile-change request', async () => {
    const { service } = makeService();
    await expect(service.requestProfileChange(self, {})).rejects.toThrow();
  });

  it('approve applies the proposed values to the user and marks the request approved', async () => {
    const { service, prisma, scope } = makeService();
    prisma.profileChangeRequest.findUnique
      .mockResolvedValueOnce({
        id: 'req-1',
        user_id: 'u1',
        status: 'pending',
        proposed_changes: { phone: '999' },
      })
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'approved',
        proposed_changes: { phone: '999' },
      });
    prisma.user.findUnique.mockResolvedValue({ full_name: 'x', phone: '111', avatar_url: null });
    const tx = {
      user: { update: jest.fn() },
      profileChangeRequest: { update: jest.fn() },
      notification: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    await service.approve(reviewer, 'req-1');

    expect(scope.canReviewRequest).toHaveBeenCalledWith(reviewer, 'u1');
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { phone: '999' } }),
    );
    expect(tx.profileChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
    );
  });

  it('reject marks the request rejected and never changes the user', async () => {
    const { service, prisma } = makeService();
    prisma.profileChangeRequest.findUnique
      .mockResolvedValueOnce({
        id: 'req-1',
        user_id: 'u1',
        status: 'pending',
        proposed_changes: { phone: '999' },
      })
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'rejected',
        proposed_changes: { phone: '999' },
      });
    const tx = {
      user: { update: jest.fn() },
      profileChangeRequest: { update: jest.fn() },
      notification: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    await service.reject(reviewer, 'req-1');

    expect(tx.profileChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
