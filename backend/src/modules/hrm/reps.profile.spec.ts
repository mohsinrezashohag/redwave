/**
 * Rep PROFILE (client request 2026-11-11) — the PII and SIN guarantees.
 *
 *   - hrm:view callers never receive DOB / contact / address / payment details / the masked SIN (HRM-008).
 *   - The SIN is encrypted on write; no response ever carries the ciphertext or the clear value.
 *   - Without PII_ENCRYPTION_KEY a SIN is refused (503) — never stored in clear text.
 *   - Every reveal is audited; no audit payload ever contains a PII value.
 */
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { RepsService, toRepView } from './reps.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const EDITOR: AuthUser = {
  id: 'actor-1',
  email: 'a@x.co',
  full_name: 'Actor',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(['hrm:view', 'hrm:create', 'hrm:edit']),
  repId: null,
};

const KEY = Buffer.alloc(32, 7).toString('base64');
const TEST_SIN = '046 454 286'; // the Government of Canada's published test SIN (valid Luhn)

const managerUser = { id: 'mgr-1', status: 'active', user_roles: [{ role: { name: 'Manager' } }] };
const newRepDto = { rep_code: 'Redwave07', full_name: 'Jordan Field', field_manager_id: 'mgr-1', hire_date: '2026-01-15' };

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'r1',
    rep_code: 'RW-1',
    external_code: null,
    user_id: null,
    full_name: 'Jordan Field',
    field_manager_id: 'mgr-1',
    status: 'active',
    hire_date: new Date('2026-01-15T00:00:00Z'),
    termination_date: null,
    payment_details: { bank: 'x' },
    created_at: new Date(),
    date_of_birth: new Date('1994-03-21T00:00:00Z'),
    phone: '204 555 0142',
    email: 'jordan@example.com',
    address_street: '1 Main St',
    address_city: 'Winnipeg',
    address_province: 'MB',
    address_postal: 'R3G 0T7',
    sin_ciphertext: 'v1.aaa.bbb.ccc',
    sin_last3: '286',
    jacket_size: 'L',
    tshirt_size: 'M',
    ...over,
  }) as never;

function make() {
  const prisma = {
    rep: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data)),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data)),
    },
    user: { findUnique: jest.fn().mockResolvedValue(managerUser) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // The key is read at construction, so the env must be set first.
  return { service: new RepsService(prisma as never, audit as never), prisma, audit };
}

const written = (fn: jest.Mock) => (fn.mock.calls[0][0] as { data: Record<string, unknown> }).data;

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.PII_ENCRYPTION_KEY;
  process.env.PII_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = savedKey;
});

describe('toRepView — what each caller may see', () => {
  it('hrm:edit sees the profile and a MASKED SIN — never the ciphertext or last3', () => {
    const v = toRepView(row(), true) as Record<string, unknown>;
    expect(v.address_postal).toBe('R3G 0T7');
    expect(v.sin_masked).toBe('••• ••• 286');
    expect(v.sin_on_file).toBe(true);
    expect(v).not.toHaveProperty('sin_ciphertext');
    expect(v).not.toHaveProperty('sin_last3');
  });

  it('hrm:view only: every PII field is null; name and sizes stay visible', () => {
    const v = toRepView(row(), false) as Record<string, unknown>;
    for (const f of [
      'payment_details', 'date_of_birth', 'phone', 'email', 'address_street', 'address_city',
      'address_province', 'address_postal', 'sin_masked',
    ]) {
      expect(v[f]).toBeNull();
    }
    expect(v.full_name).toBe('Jordan Field');
    expect(v.jacket_size).toBe('L');
    expect(JSON.stringify(v)).not.toContain('v1.aaa');
  });
});

describe('writing the profile', () => {
  it('create ENCRYPTS the SIN, keeps only its last 3, and returns no ciphertext', async () => {
    const { service, prisma } = make();
    const res = (await service.create({ ...newRepDto, sin: TEST_SIN, address_postal: 'r3g0t7' }, EDITOR)) as Record<string, unknown>;
    const data = written(prisma.rep.create);
    expect(data.sin_ciphertext).toMatch(/^v1\./);
    expect(String(data.sin_ciphertext)).not.toContain('046454286');
    expect(data.sin_last3).toBe('286');
    expect(data.address_postal).toBe('R3G 0T7');
    expect(res).not.toHaveProperty('sin_ciphertext');
    expect(res.sin_masked).toBe('••• ••• 286');
  });

  it('the audit log records PRESENCE only — never a SIN, DOB, address or contact value', async () => {
    const { service, audit } = make();
    await service.create(
      { ...newRepDto, sin: TEST_SIN, date_of_birth: '1994-03-21', email: 'jordan@example.com', address_street: '1 Main St' },
      EDITOR,
    );
    const logged = JSON.stringify(audit.log.mock.calls);
    for (const secret of ['046454286', '046 454', 'v1.', 'jordan@example.com', '1 Main St', '1994-03-21']) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('"sin_present":true');
  });

  it('rejects an invalid SIN (Luhn), a future DOB and a bad postal code with 422', async () => {
    const { service, prisma } = make();
    await expect(service.create({ ...newRepDto, sin: '046 454 287' }, EDITOR)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.create({ ...newRepDto, date_of_birth: '2999-01-01' }, EDITOR)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.create({ ...newRepDto, address_postal: '12345' }, EDITOR)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.rep.create).not.toHaveBeenCalled();
  });

  it('without PII_ENCRYPTION_KEY a SIN is REFUSED (503) — never stored in clear text', async () => {
    delete process.env.PII_ENCRYPTION_KEY;
    const { service, prisma } = make();
    await expect(service.create({ ...newRepDto, sin: TEST_SIN }, EDITOR)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.rep.create).not.toHaveBeenCalled();
  });

  it('…but a rep WITHOUT a SIN can still be created when the key is missing', async () => {
    delete process.env.PII_ENCRYPTION_KEY;
    const { service, prisma } = make();
    await service.create({ ...newRepDto, jacket_size: 'L' }, EDITOR);
    expect(prisma.rep.create).toHaveBeenCalled();
  });

  it('update: an empty SIN clears it; null clears a field; undefined leaves it alone', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue(row());
    await service.update('r1', { sin: '', phone: null }, EDITOR);
    const data = written(prisma.rep.update);
    expect(data.sin_ciphertext).toBeNull();
    expect(data.sin_last3).toBeNull();
    expect(data.phone).toBeNull();
    expect(data).not.toHaveProperty('email');
  });
});

describe('revealing the SIN', () => {
  it('decrypts what create encrypted, and AUDITS the reveal without the value', async () => {
    const { service, prisma, audit } = make();
    await service.create({ ...newRepDto, sin: TEST_SIN }, EDITOR);
    const stored = written(prisma.rep.create).sin_ciphertext;

    prisma.rep.findUnique.mockResolvedValue({ id: 'r1', sin_ciphertext: stored });
    audit.log.mockClear();
    await expect(service.revealSin('r1', 'actor-1')).resolves.toEqual({ sin: '046 454 286' });
    expect(audit.log).toHaveBeenCalledWith({ actorId: 'actor-1', entityType: 'reps', entityId: 'r1', action: 'reveal_sin' });
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('046');
  });

  it('a rep with no SIN on file returns null and logs nothing', async () => {
    const { service, prisma, audit } = make();
    prisma.rep.findUnique.mockResolvedValue({ id: 'r1', sin_ciphertext: null });
    await expect(service.revealSin('r1', 'actor-1')).resolves.toEqual({ sin: null });
    expect(audit.log).not.toHaveBeenCalled();
  });
});
