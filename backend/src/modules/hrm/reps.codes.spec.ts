/**
 * Rep codes (client meeting 2026-11-16, "rep creations may not be recorded after REDWAVE15"):
 *   - every unique field (rep_code, partner code, linked login) is pre-checked and the 409 names the clash,
 *     on create AND update; a rep code may not equal another rep's partner code (imports resolve by either);
 *   - the roster's rep_code sort is NATURAL (REDWAVE2 before REDWAVE10), and correct across pages.
 */
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RepsService, uniqueViolationMessage } from './reps.service';
import { codeClashMessage, compareRepCodes, sortByRepCode } from './rep-code.logic';
import { AuthUser } from '../../common/rbac/auth-user.type';

const EDITOR: AuthUser = {
  id: 'actor-1',
  email: 'a@x.co',
  full_name: 'Actor',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(['hrm:view', 'hrm:edit']),
  repId: null,
};

const managerUser = { id: 'mgr-1', status: 'active', user_roles: [{ role: { name: 'Manager' } }] };
const dto = { rep_code: 'REDWAVE16', full_name: 'New Rep', field_manager_id: 'mgr-1', hire_date: '2026-11-16' };

function make() {
  const prisma = {
    rep: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'new', rep_code: 'REDWAVE16', payment_details: null }),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue(managerUser) },
  };
  const audit = { log: jest.fn() };
  const avatars = { withRepPhotos: async (rows: unknown[]) => rows.map((r) => ({ ...(r as object), photo_url: null })) };
  return { service: new RepsService(prisma as never, audit as never, avatars as never), prisma };
}

const other = (over: Partial<{ rep_code: string; external_code: string | null; full_name: string; status: string }> = {}) => ({
  rep_code: 'REDWAVE15',
  external_code: null,
  full_name: 'Sam Field',
  status: 'active',
  ...over,
});

describe('rep-code.logic (pure)', () => {
  it('compares rep codes naturally and case-insensitively', () => {
    const codes = ['REDWAVE10', 'REDWAVE2', 'redwave11', 'REDWAVE1', 'REDWAVE19', 'REDWAVE20'];
    expect([...codes].sort(compareRepCodes)).toEqual(['REDWAVE1', 'REDWAVE2', 'REDWAVE10', 'redwave11', 'REDWAVE19', 'REDWAVE20']);
  });

  it('sortByRepCode is stable on ties and supports desc', () => {
    const rows = [
      { id: 'b', rep_code: 'RW-2' },
      { id: 'a', rep_code: 'RW-10' },
      { id: 'c', rep_code: 'RW-2' },
    ];
    expect(sortByRepCode(rows, 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortByRepCode(rows, 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('names each clash precisely', () => {
    expect(codeClashMessage('rep_code', 'REDWAVE15', other())).toMatch(/already used by REDWAVE15 \(Sam Field\)/);
    expect(codeClashMessage('rep_code', 'REDWAVE15', other({ status: 'terminated' }))).toMatch(/terminated/);
    expect(codeClashMessage('rep_code', 'RW20', other({ external_code: 'RW20' }))).toMatch(/partner code of REDWAVE15/);
    expect(codeClashMessage('external_code', 'RW20', other({ external_code: 'rw20' }))).toMatch(/^Partner code RW20 is already used by REDWAVE15/);
    expect(codeClashMessage('external_code', 'REDWAVE15', other())).toMatch(/is the rep code of REDWAVE15/);
    expect(codeClashMessage('external_code', 'X', other())).toBeNull();
  });
});

describe('RepsService.create — precise 409 per unique field', () => {
  it('a duplicate PARTNER code is reported as such (was: "rep_code already used")', async () => {
    const { service, prisma } = make();
    prisma.rep.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(other({ external_code: 'REDWAVE20' }));
    await expect(service.create({ ...dto, external_code: 'redwave20' }, EDITOR)).rejects.toThrow(
      /Partner code REDWAVE20 is already used by REDWAVE15/,
    );
    expect(prisma.rep.create).not.toHaveBeenCalled();
  });

  it('a rep code equal to another rep’s partner code is refused', async () => {
    const { service, prisma } = make();
    prisma.rep.findFirst.mockResolvedValueOnce(other({ external_code: 'REDWAVE16' }));
    await expect(service.create(dto, EDITOR)).rejects.toThrow(/partner code of REDWAVE15/);
  });

  it('a login already linked to another rep is 409; an unknown login is 422', async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
    prisma.rep.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(other());
    await expect(service.create({ ...dto, user_id: 'u1' }, EDITOR)).rejects.toThrow(/already linked to REDWAVE15/);

    const second = make();
    second.prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(second.service.create({ ...dto, user_id: 'u2' }, EDITOR)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('stores the trimmed code + an UPPER-cased partner code and saves the login', async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValueOnce(managerUser);
    await service.create({ ...dto, rep_code: ' REDWAVE16 ', external_code: ' rw16 ', user_id: 'u1' }, EDITOR);
    expect(prisma.rep.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ rep_code: 'REDWAVE16', external_code: 'RW16', user_id: 'u1' }),
    );
  });

  it('the DB backstop names the column the constraint fired on', () => {
    const err = (target: string[]) =>
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target } });
    expect(uniqueViolationMessage(err(['external_code']))).toMatch(/partner code/);
    expect(uniqueViolationMessage(err(['user_id']))).toMatch(/login/);
    expect(uniqueViolationMessage(err(['rep_code']))).toMatch(/rep code/);
  });
});

describe('RepsService.update — unique checks + unlinking', () => {
  const before = { id: 'r1', rep_code: 'REDWAVE3', external_code: 'RW3', user_id: 'u-old', field_manager_id: 'mgr-1', payment_details: null };

  it('checks a CHANGED partner code against other reps (never itself)', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue(before);
    prisma.rep.findFirst.mockResolvedValueOnce(other({ external_code: 'RW9' }));
    await expect(service.update('r1', { external_code: 'rw9' }, EDITOR)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.rep.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 'r1' });
    expect(prisma.rep.update).not.toHaveBeenCalled();
  });

  it('an unchanged partner code / login is not re-checked', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue(before);
    prisma.rep.update.mockResolvedValue({ ...before });
    await service.update('r1', { external_code: 'rw3', user_id: 'u-old' }, EDITOR);
    expect(prisma.rep.findFirst).not.toHaveBeenCalled();
  });

  it('user_id null unlinks the login', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue(before);
    prisma.rep.update.mockResolvedValue({ ...before, user_id: null });
    await service.update('r1', { user_id: null }, EDITOR);
    expect(prisma.rep.update.mock.calls[0][0].data.user_id).toBeNull();
  });

  it('a unique violation on update is a 409, not a 500', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue(before);
    prisma.rep.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['user_id'] } }),
    );
    await expect(service.update('r1', { full_name: 'X' }, EDITOR)).rejects.toThrow(/login is already linked/);
  });
});

describe('RepsService.findAll — natural rep_code order across pages', () => {
  const keys = Array.from({ length: 25 }, (_, i) => ({ id: `id${i + 1}`, rep_code: `REDWAVE${i + 1}` }));
  // The DB would return text order: REDWAVE1, REDWAVE10..19, REDWAVE2, REDWAVE20..25, REDWAVE3..
  const textOrder = [...keys].sort((a, b) => (a.rep_code < b.rep_code ? -1 : 1));

  it('page 1 (default sort) holds REDWAVE1..20 in numeric order; page 2 the rest', async () => {
    const { service, prisma } = make();
    prisma.rep.findMany.mockImplementation(async (args: { select?: unknown; where: { id?: { in: string[] } } }) => {
      if (args.select) return textOrder;
      const ids = args.where.id!.in;
      return keys.filter((k) => ids.includes(k.id)).map((k) => ({ ...k, payment_details: null, sin_ciphertext: null }));
    });
    const p1 = await service.findAll({}, EDITOR);
    expect(p1.data.map((r) => r.rep_code)).toEqual(Array.from({ length: 20 }, (_, i) => `REDWAVE${i + 1}`));
    expect(p1.meta).toEqual({ total: 25, page: 1, limit: 20, pageCount: 2 });
    const p2 = await service.findAll({ page: 2, sort: 'rep_code:asc' }, EDITOR);
    expect(p2.data.map((r) => r.rep_code)).toEqual(['REDWAVE21', 'REDWAVE22', 'REDWAVE23', 'REDWAVE24', 'REDWAVE25']);
    const desc = await service.findAll({ limit: 3, sort: 'rep_code:desc' }, EDITOR);
    expect(desc.data.map((r) => r.rep_code)).toEqual(['REDWAVE25', 'REDWAVE24', 'REDWAVE23']);
  });

  it('another allowlisted sort still orders in the database; an unknown one falls back to natural rep_code', async () => {
    const { service, prisma } = make();
    prisma.rep.findMany.mockResolvedValue([]);
    prisma.rep.count.mockResolvedValue(0);
    await service.findAll({ sort: 'full_name:asc' }, EDITOR);
    expect(prisma.rep.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { full_name: 'asc' } }));
    prisma.rep.findMany.mockClear();
    await service.findAll({ sort: 'sin_ciphertext:asc' }, EDITOR);
    expect(prisma.rep.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, rep_code: true } }));
  });
});
