import * as fs from 'fs';
import * as path from 'path';
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
    rep: { findUnique: jest.fn().mockResolvedValue(null) },
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
  const avatars = {
    withDisplayUrl: jest.fn(async (u: unknown) => u),
    withDisplayUrls: jest.fn(async (u: unknown) => u),
    previewPath: jest.fn(async (p: string | null) => (p ? `https://signed/${p}` : null)),
  };
  const files = { claim: jest.fn().mockResolvedValue({}) };
  const service = new AccountService(prisma as never, audit as never, scope as never, emitter as never, avatars as never, files as never);
  return { service, prisma, audit, scope, avatars, files };
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

// Client request 2026-11-11: a rep may REQUEST contact email / address / sizes; everything else on the rep
// profile is admin-only. Approval writes them to the REP record.
describe('AccountService — rep profile change requests', () => {
  const nonRep: AuthUser = { ...self, id: 'u2', repId: null };

  it('a rep can request address + sizes; the postal code is normalised; nothing applies yet', async () => {
    const { service, prisma } = makeService();
    prisma.profileChangeRequest.create.mockImplementation(async ({ data }: { data: unknown }) => data);
    await service.requestProfileChange(self, { address_postal: 'r3g0t7', address_city: ' Winnipeg ', jacket_size: 'L' });
    const data = (prisma.profileChangeRequest.create.mock.calls[0][0] as { data: { proposed_changes: unknown } }).data;
    expect(data.proposed_changes).toEqual({ address_postal: 'R3G 0T7', address_city: 'Winnipeg', jacket_size: 'L' });
  });

  it('rep-only fields are refused for a user with no linked rep', async () => {
    const { service, prisma } = makeService();
    await expect(service.requestProfileChange(nonRep, { jacket_size: 'L' })).rejects.toThrow(/not linked to a rep/);
    expect(prisma.profileChangeRequest.create).not.toHaveBeenCalled();
  });

  it('a bad postal code is refused', async () => {
    const { service } = makeService();
    await expect(service.requestProfileChange(self, { address_postal: '12345' })).rejects.toThrow(/postal/);
  });

  it('the audit log records rep contact/address as PRESENCE only', async () => {
    const { service, prisma, audit } = makeService();
    prisma.profileChangeRequest.create.mockResolvedValue({ id: 'req-1' });
    await service.requestProfileChange(self, { email: 'Me@Example.com', address_street: '1 Main St', tshirt_size: 'M' });
    const logged = JSON.stringify(audit.log.mock.calls);
    expect(logged).not.toContain('me@example.com');
    expect(logged).not.toContain('1 Main St');
    expect(logged).toContain('"tshirt_size":"M"');
  });

  it('approve writes rep fields to the REP and mirrors name + phone onto it', async () => {
    const { service, prisma } = makeService();
    const proposed = { full_name: 'Jo Field', phone: '204 555 0100', address_city: 'Brandon', jacket_size: 'XL' };
    prisma.profileChangeRequest.findUnique
      .mockResolvedValueOnce({ id: 'req-1', user_id: 'u1', status: 'pending', proposed_changes: proposed })
      .mockResolvedValueOnce({ id: 'req-1', status: 'approved', proposed_changes: proposed });
    prisma.user.findUnique.mockResolvedValue({ full_name: 'x', phone: null, avatar_url: null });
    prisma.rep.findUnique.mockResolvedValue({ id: 'rep-1' });
    const tx = { user: { update: jest.fn() }, rep: { update: jest.fn() }, profileChangeRequest: { update: jest.fn() } };
    prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    await service.approve(reviewer, 'req-1');

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { full_name: 'Jo Field', phone: '204 555 0100' } });
    expect(tx.rep.update).toHaveBeenCalledWith({
      where: { id: 'rep-1' },
      data: { address_city: 'Brandon', jacket_size: 'XL', full_name: 'Jo Field', phone: '204 555 0100' },
    });
  });

  it('the request DTO cannot carry an admin-only field (DOB, SIN, rep code, status, manager)', () => {
    // Structural: these keys do not exist on ProfileChangeRequestDto, so pickProposed can never forward them.
    const src = fs.readFileSync(path.join(__dirname, 'dto', 'account.dto.ts'), 'utf8');
    const dto = src.slice(src.indexOf('class ProfileChangeRequestDto'));
    for (const forbidden of ['date_of_birth', 'sin', 'rep_code', 'status', 'field_manager_id', 'hire_date']) {
      expect(dto).not.toMatch(new RegExp(`\\b${forbidden}\\??!?:`));
    }
  });
});

describe('profile photo — uploaded, never a link (2026-11-12)', () => {
  const admin: AuthUser = { ...self, id: 'u-admin', roleNames: ['Admin'], repId: null };

  it('a non-rep proposes an uploaded avatar path — claimed as THEIR avatar file', async () => {
    const { service, prisma, files } = makeService();
    prisma.profileChangeRequest.create.mockResolvedValue({ id: 'r1', status: 'pending', proposed_changes: {}, created_at: new Date() });
    await service.requestProfileChange(admin, { avatar_url: 'avatars/2026/11/a.jpg' });
    expect(files.claim).toHaveBeenCalledWith('avatars/2026/11/a.jpg', admin, 'avatar');
  });

  it('a pasted link is refused (the claim rejects it); removing the photo needs no claim', async () => {
    const { service, prisma, files } = makeService();
    files.claim.mockRejectedValueOnce(new Error('unknown avatar file reference'));
    await expect(service.requestProfileChange(admin, { avatar_url: 'https://example.com/me.png' })).rejects.toThrow(/unknown avatar/);
    expect(prisma.profileChangeRequest.create).not.toHaveBeenCalled();
    prisma.profileChangeRequest.create.mockResolvedValue({ id: 'r2', status: 'pending', proposed_changes: {}, created_at: new Date() });
    files.claim.mockClear();
    await service.requestProfileChange(admin, { avatar_url: '' });
    expect(files.claim).not.toHaveBeenCalled();
  });

  it('a rep cannot set a photo — it is their HR headshot', async () => {
    const { service, prisma } = makeService();
    await expect(service.requestProfileChange(self, { avatar_url: 'avatars/2026/11/a.jpg' })).rejects.toThrow(/headshot/);
    expect(prisma.profileChangeRequest.create).not.toHaveBeenCalled();
  });

  it('the review queue shows the PROPOSED photo as a preview URL, and the subject photo resolved', async () => {
    const { service, prisma, avatars, scope } = makeService();
    scope.profileReviewWhere.mockReturnValue({});
    (avatars as unknown as { resolve: jest.Mock }).resolve = jest.fn().mockResolvedValue(new Map([['u-admin', 'https://signed/current']]));
    prisma.profileChangeRequest.findMany.mockResolvedValue([
      {
        id: 'r1',
        proposed_changes: { avatar_url: 'avatars/2026/11/new.jpg' },
        created_at: new Date(),
        requested_by: 'u-admin',
        subject: { id: 'u-admin', email: 'a@x.co', full_name: 'Ad Min', phone: null, avatar_url: 'avatars/old.jpg', rep_login: null },
      },
    ]);
    const [row] = await service.listReviewQueue(reviewer);
    expect(row.proposed_avatar_preview).toBe('https://signed/avatars/2026/11/new.jpg');
    expect(row.subject.avatar_url).toBe('https://signed/current');
  });
});

describe('Super Admin profile (2026-11-12): built-in avatars, no review', () => {
  const sa: AuthUser = { ...reviewer, id: 'sa-1', full_name: 'Super Admin' };

  it('picks a built-in avatar and it applies at once (recorded as an approved request, audited)', async () => {
    const { service, prisma, audit, files } = makeService();
    const tx = {
      user: { update: jest.fn() },
      profileChangeRequest: { create: jest.fn().mockResolvedValue({ id: 'r1', status: 'approved' }) },
    };
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    prisma.user.findUnique.mockResolvedValue({ full_name: 'Super Admin', phone: null, avatar_url: null });
    const r = await service.requestProfileChange(sa, { avatar_url: 'preset:wave' });
    expect(r.status).toBe('approved');
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'sa-1' }, data: { avatar_url: 'preset:wave' } });
    expect(tx.profileChangeRequest.create.mock.calls[0][0].data).toMatchObject({ status: 'approved', reviewed_by: 'sa-1' });
    expect(files.claim).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve' }));
    expect(prisma.profileChangeRequest.create).not.toHaveBeenCalled(); // no pending request
  });

  it('the Super Admin cannot upload a photo; nobody else can use a built-in avatar', async () => {
    const { service } = makeService();
    await expect(service.requestProfileChange(sa, { avatar_url: 'avatars/2026/11/a.jpg' })).rejects.toThrow(/built-in avatars/);
    const admin: AuthUser = { ...self, id: 'u-admin', roleNames: ['Admin'], repId: null };
    await expect(service.requestProfileChange(admin, { avatar_url: 'preset:wave' })).rejects.toThrow(/JPG or PNG/);
  });
});
