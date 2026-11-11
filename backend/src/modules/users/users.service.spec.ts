import { UsersService } from './users.service';

function make() {
  const created = { id: 'u1', email: 'jane@x.co', full_name: 'Jane' };
  const tx = {
    user: { create: jest.fn().mockResolvedValue(created) },
    userRole: { createMany: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'jane@x.co', full_name: 'Jane' }), update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const mailer = {
    sendInvite: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    sendTempPassword: jest.fn().mockResolvedValue(undefined),
  };
  const passwordReset = { issueToken: jest.fn().mockResolvedValue('token-123') };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(0) };
  const mfa = { adminDisable: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(
    prisma as never,
    audit as never,
    mailer as never,
    passwordReset as never,
    sessions as never,
    mfa as never,
    { withDisplayUrl: async (u: unknown) => u, withDisplayUrls: async (u: unknown) => u } as never,
  );
  return { service, prisma, tx, mailer, passwordReset, sessions, mfa };
}

describe('UsersService.create — invite vs password', () => {
  it('INVITES when no password: must_change_password + an invite email (no shown password)', async () => {
    const { service, tx, mailer, passwordReset } = make();
    await service.create({ email: 'jane@x.co', full_name: 'Jane' } as never, 'admin');
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ must_change_password: true }) }),
    );
    expect(passwordReset.issueToken).toHaveBeenCalledWith('u1', 'invite');
    expect(mailer.sendInvite).toHaveBeenCalledWith('jane@x.co', 'Jane', 'token-123');
  });

  it('sets the provided password (must_change false; no invite email)', async () => {
    const { service, tx, mailer } = make();
    await service.create({ email: 'jane@x.co', full_name: 'Jane', password: 'Redwave1' } as never, 'admin');
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ must_change_password: false }) }),
    );
    expect(mailer.sendInvite).not.toHaveBeenCalled();
  });
});

describe('UsersService.resetPassword — admin never sees the password', () => {
  it('mode=link emails a reset link', async () => {
    const { service, mailer, passwordReset } = make();
    await service.resetPassword('u1', { mode: 'link' }, 'admin');
    expect(passwordReset.issueToken).toHaveBeenCalledWith('u1', 'reset');
    expect(mailer.sendPasswordReset).toHaveBeenCalled();
  });

  it('mode=temp emails a forced-change temp password (not returned to the admin)', async () => {
    const { service, prisma, mailer } = make();
    const result = await service.resetPassword('u1', { mode: 'temp' }, 'admin');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ must_change_password: true }) }),
    );
    expect(mailer.sendTempPassword).toHaveBeenCalled();
    expect(result).toEqual({ success: true }); // no password in the response
    expect(JSON.stringify(result)).not.toMatch(/password/i);
  });
});
