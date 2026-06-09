import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { canSeeSensitive, redactRep, repStatusWhere, RepsService } from './reps.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const authUser = (perms: string[]): AuthUser => ({
  id: 'actor-1',
  email: 'a@x.co',
  full_name: 'Actor',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(perms),
  repId: null,
});

const VIEW_ONLY = authUser(['hrm:view']);
const EDITOR = authUser(['hrm:view', 'hrm:edit']);

function make() {
  const prisma = {
    rep: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new RepsService(prisma as never, audit as never), prisma, audit };
}

const managerUser = { id: 'mgr-1', status: 'active', user_roles: [{ role: { name: 'Manager' } }] };
const newRepDto = {
  rep_code: 'Redwave07',
  full_name: 'Jordan Field',
  field_manager_id: 'mgr-1',
  hire_date: '2026-01-15',
};

describe('repStatusWhere / redactRep / canSeeSensitive (pure)', () => {
  it('defaults to active; terminated/all handled', () => {
    expect(repStatusWhere(undefined)).toEqual({ status: 'active' });
    expect(repStatusWhere('terminated')).toEqual({ status: 'terminated' });
    expect(repStatusWhere('all')).toEqual({});
  });
  it('redactRep nulls payment_details unless allowed', () => {
    const rep = { id: 'r', payment_details: { bank: 'x' } };
    expect(redactRep(rep, false).payment_details).toBeNull();
    expect(redactRep(rep, true).payment_details).toEqual({ bank: 'x' });
  });
  it('canSeeSensitive requires hrm:edit', () => {
    expect(canSeeSensitive(VIEW_ONLY)).toBe(false);
    expect(canSeeSensitive(EDITOR)).toBe(true);
  });
});

describe('RepsService.create — rep_code no-reuse (#11, HRM-003)', () => {
  it('creates a rep with a brand-new code', async () => {
    const { service, prisma } = make();
    prisma.rep.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(managerUser);
    prisma.rep.create.mockResolvedValue({ id: 'r1', rep_code: 'Redwave07', payment_details: null });

    await service.create(newRepDto, 'actor-1');

    expect(prisma.rep.create).toHaveBeenCalled();
  });

  it('rejects reuse of an ACTIVE code with 409', async () => {
    const { service, prisma } = make();
    prisma.rep.findFirst.mockResolvedValue({ id: 'existing-active' });
    await expect(service.create(newRepDto, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.rep.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a TERMINATED rep code with 409 — the key no-reuse case', async () => {
    const { service, prisma } = make();
    // A terminated rep still holds its code; the no-reuse check spans ALL statuses.
    prisma.rep.findFirst.mockResolvedValue({ id: 'terminated-rep' });

    await expect(service.create(newRepDto, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
    // The lookup must NOT filter by status (so terminated reps are included) and is case-insensitive.
    expect(prisma.rep.findFirst).toHaveBeenCalledWith({
      where: { rep_code: { equals: 'Redwave07', mode: 'insensitive' } },
      select: { id: true },
    });
    expect(prisma.rep.create).not.toHaveBeenCalled();
  });
});

describe('RepsService.create — field-manager validation (HRM-002)', () => {
  it('rejects a non-existent field manager (422)', async () => {
    const { service, prisma } = make();
    prisma.rep.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.create(newRepDto, 'actor-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a user without the Manager role (422)', async () => {
    const { service, prisma } = make();
    prisma.rep.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u',
      status: 'active',
      user_roles: [{ role: { name: 'Sales Rep' } }],
    });
    await expect(service.create(newRepDto, 'actor-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('RepsService.update — termination (HRM-004)', () => {
  it('terminating sets status + termination_date and never deletes the record', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'active',
      field_manager_id: 'mgr-1',
      payment_details: null,
      termination_date: null,
    });
    prisma.rep.update.mockResolvedValue({ id: 'r1', status: 'terminated', payment_details: null });

    await service.update('r1', { status: 'terminated', termination_date: '2026-06-30' }, 'actor-1');

    const arg = prisma.rep.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBe('terminated');
    expect(arg.data.termination_date).toBeInstanceOf(Date);
    expect((prisma.rep as Record<string, unknown>).delete).toBeUndefined(); // no hard delete
  });

  it('rejects termination without a termination_date (422)', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'active',
      field_manager_id: 'mgr-1',
    });
    await expect(service.update('r1', { status: 'terminated' }, 'actor-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('RepsService.findAll — filters & sensitive redaction (HRM-007/008)', () => {
  it('defaults to active and applies fieldManager + search filters', async () => {
    const { service, prisma } = make();
    prisma.rep.findMany.mockResolvedValue([]);
    await service.findAll({ fieldManagerId: 'mgr-1', search: 'red' }, EDITOR);
    expect(prisma.rep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'active',
          field_manager_id: 'mgr-1',
          OR: [
            { full_name: { contains: 'red', mode: 'insensitive' } },
            { rep_code: { contains: 'red', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('redacts payment_details for a view-only caller, includes it for an editor', async () => {
    const { service, prisma } = make();
    const rep = { id: 'r1', rep_code: 'R1', payment_details: { bank: 'secret' } };
    prisma.rep.findUnique.mockResolvedValue({ ...rep });
    expect((await service.findOne('r1', VIEW_ONLY)).payment_details).toBeNull();
    prisma.rep.findUnique.mockResolvedValue({ ...rep });
    expect((await service.findOne('r1', EDITOR)).payment_details).toEqual({ bank: 'secret' });
  });
});
