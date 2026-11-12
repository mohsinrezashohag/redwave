import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../rbac/auth-user.type';
import { RequiredPermission } from '../decorators/require-permission.decorator';

function makeContext(user: Partial<AuthUser> | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, method: 'GET', url: '/v1/roles', originalUrl: '/v1/roles' }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(required: RequiredPermission | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { guard: new PermissionsGuard(reflector, audit), audit };
}

const userWith = (perms: string[]): Partial<AuthUser> => ({
  id: 'user-1',
  permissions: new Set(perms),
});

describe('PermissionsGuard (AUTH-006)', () => {
  it('allows a user that holds the required permission (and does not audit)', async () => {
    const { guard, audit } = makeGuard({ moduleKey: 'roles', action: 'view' });
    await expect(guard.canActivate(makeContext(userWith(['roles:view'])))).resolves.toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('denies with 403 AND writes an audit entry when the permission is missing', async () => {
    const { guard, audit } = makeGuard({ moduleKey: 'roles', action: 'view' });
    await expect(guard.canActivate(makeContext(userWith([])))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'access_denied',
        after: expect.objectContaining({ required: 'roles:view' }),
      }),
    );
  });

  it('allows routes that declare no permission (auth-only)', async () => {
    const { guard, audit } = makeGuard(undefined);
    await expect(guard.canActivate(makeContext(userWith([])))).resolves.toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('the Super Admin passes every check, even one its role row lacks (2026-11-12)', async () => {
    const { guard, audit } = makeGuard({ moduleKey: 'audit', action: 'approve' });
    await expect(guard.canActivate(makeContext({ ...userWith([]), isSuperAdmin: true }))).resolves.toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
