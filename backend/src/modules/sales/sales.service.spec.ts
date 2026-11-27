import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { todayInWinnipeg } from '../../common/timezone';

type Scope =
  | { level: 'all' }
  | { level: 'roster'; repIds: string[] }
  | { level: 'self'; repIds: string[] };

const authUser = (repId: string | null): AuthUser => ({
  id: 'user-1',
  email: 'u@x.co',
  full_name: 'U',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(),
  repId,
});

function make(scope: Scope) {
  // loadScoped reads the sale via the active db client (tx inside validateWithinTx, prisma otherwise),
  // so share one findFirst mock between both — tests set it once via prisma.sale.findFirst.
  const saleFindFirst = jest.fn();
  const tx = {
    sale: {
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      findFirst: saleFindFirst,
      findMany: jest.fn().mockResolvedValue([]), // duplicate candidates (2026-11-28)
      // createWithinTx writes + counts through the CALLER's tx (Import commit).
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    saleItem: { updateMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    saleEditRequest: { findUnique: jest.fn(), update: jest.fn() },
    rep: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
    product: { findMany: jest.fn() },
  };
  const prisma = {
    rep: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
    product: { findMany: jest.fn() },
    sale: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findFirst: saleFindFirst,
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    saleItem: { updateMany: jest.fn() },
    saleEditRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    payPeriod: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scopeSvc = { getRepScope: jest.fn().mockResolvedValue(scope) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  return {
    service: new SalesService(prisma as never, audit as never, scopeSvc as never, emitter as never),
    prisma,
    audit,
    tx,
    emitter,
  };
}

const SELF: Scope = { level: 'self', repIds: ['rep-self'] };
const ALL: Scope = { level: 'all' };

const createDto = {
  client_id: 'c1',
  customer_name: 'Jane',
  street: '1 St',
  city: 'Town',
  province_state: 'MB',
  postal_code: 'R0R0R0',
  items: [{ product_id: 'p1' }],
};

describe('SalesService.create', () => {
  it('rejects an out-of-scope rep_id with 403 (+ audit) — scoping enforced', async () => {
    const { service, audit, prisma } = make(SELF);
    await expect(
      service.create({ ...createDto, rep_id: 'rep-other' }, authUser('rep-self')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied' }));
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('defaults rep to the caller, creates items with snapshots NULL and derived counts_toward_tally', async () => {
    const { service, prisma } = make(SELF);
    prisma.rep.findUnique.mockResolvedValue({ status: 'active' });
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, client_code: 'VF' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: 'internet', is_active: true, product_type_ref: { behaviour: 'internet' } },
    ]);
    prisma.sale.create.mockResolvedValue({ id: 's1', sale_code: 'x', sale_items: [] });

    await service.create(createDto, authUser('rep-self'));

    const arg = prisma.sale.create.mock.calls[0][0] as {
      data: {
        sale_code: string;
        rep_id: string;
        status: string;
        validated_by?: string;
        sale_items: { create: Array<Record<string, unknown>> };
      };
    };
    expect(arg.data.rep_id).toBe('rep-self'); // defaulted to caller
    // No per-sale validation step (App Review Feedback 2026-11-28): a clean sale is validated at submit.
    expect(arg.data.status).toBe('validated');
    expect(arg.data.validated_by).toBe('user-1');
    expect(arg.data.sale_code).toMatch(/^\d{4}-\d{2}-\d{2}-VF$/); // no MPU → composed without it
    const item = arg.data.sale_items.create[0];
    expect(item.product_type).toBe('internet');
    expect(item.counts_toward_tally).toBe(true); // internet + not greenfield
    // snapshots must NOT be set (they stay NULL until Pay Run)
    expect(item).not.toHaveProperty('rate_applied');
    expect(item).not.toHaveProperty('commission_paid');
    expect(item).not.toHaveProperty('tier_at_payment');
    expect(item).not.toHaveProperty('incentive_amount');
  });

  it('rejects a standalone add-on sale (no internet base) with 422 — SALE-001a', async () => {
    const { service, prisma } = make(SELF);
    prisma.rep.findUnique.mockResolvedValue({ status: 'active' });
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, client_code: 'VF' });
    // Only a TV add-on (standard_addon) — no internet/greenfield base.
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: 'tv', is_active: true, product_type_ref: { behaviour: 'standard_addon' } },
    ]);

    await expect(service.create(createDto, authUser('rep-self'))).rejects.toMatchObject({
      status: 422,
    });
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('accepts an add-on ALONGSIDE an internet base — SALE-001a', async () => {
    const { service, prisma } = make(SELF);
    prisma.rep.findUnique.mockResolvedValue({ status: 'active' });
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, client_code: 'VF' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: 'internet', is_active: true, product_type_ref: { behaviour: 'internet' } },
      { id: 'p2', product_type: 'tv', is_active: true, product_type_ref: { behaviour: 'standard_addon' } },
    ]);
    prisma.sale.create.mockResolvedValue({ id: 's1', sale_code: 'x', sale_items: [] });

    await service.create(
      { ...createDto, items: [{ product_id: 'p1' }, { product_id: 'p2' }] },
      authUser('rep-self'),
    );
    expect(prisma.sale.create).toHaveBeenCalled();
  });
});

describe('SalesService.create — one live sale per client + MPU (§14 rule 8)', () => {
  const arrange = () => {
    const ctx = make(SELF);
    ctx.prisma.rep.findUnique.mockResolvedValue({ status: 'active' });
    ctx.prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, client_code: 'VF' });
    ctx.prisma.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: 'internet', is_active: true, product_type_ref: { behaviour: 'internet' } },
    ]);
    ctx.prisma.sale.create.mockResolvedValue({ id: 's1', sale_code: 'x', sale_items: [] });
    return ctx;
  };

  it('creates a second live sale with the same MPU FLAGGED as a possible duplicate, and notifies approvers (2026-11-16)', async () => {
    const { service, prisma, emitter } = arrange();
    prisma.sale.findMany.mockImplementation(async (args: { where: { duplicate_of_sale_id?: unknown } }) =>
      args.where.duplicate_of_sale_id
        ? [{ id: 's1', sale_code: 'x', customer_name: 'Jane', duplicate_of_sale_id: 'orig', duplicate_reason: 'mpu', rep: { field_manager_id: 'mgr-1' } }]
        : [{ id: 'orig', sale_code: '2026-07-03-MPU-3291-VF', customer_name: 'Other Person', street: '9 Far Rd', city: 'Elsewhere', mpu_id: '3291' }],
    );
    await service.create({ ...createDto, mpu_id: '3291' }, authUser('rep-self'));

    const data = (prisma.sale.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.duplicate_of_sale_id).toBe('orig');
    expect(data.duplicate_reason).toBe('mpu');
    expect(data.status).toBe('entered'); // HELD for review, not validated
    expect(data.validated_by).toBeUndefined();
    const where = (prisma.sale.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ client_id: 'c1', status: { not: 'deleted' } });
    expect(emitter.emitRole).toHaveBeenCalledWith('Admin', expect.objectContaining({ eventType: 'duplicate_sale_flagged' }));
    expect(emitter.emitMany).toHaveBeenCalledWith(['mgr-1'], expect.objectContaining({
      variables: expect.objectContaining({ original_sale_code: '2026-07-03-MPU-3291-VF' }),
    }));
  });

  it('creates the sale unflagged when no live sale has that MPU', async () => {
    const { service, prisma, emitter } = arrange();
    await service.create({ ...createDto, mpu_id: '3291' }, authUser('rep-self'));
    const data = (prisma.sale.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.duplicate_of_sale_id).toBeNull();
    expect(data.status).toBe('validated');
    expect(emitter.emitRole).not.toHaveBeenCalled();
  });

  it('flags a sale with no MPU at the same address as an existing one (App Review Feedback High #3, 2026-11-28)', async () => {
    const { service, prisma, emitter } = arrange();
    prisma.sale.findMany.mockImplementation(async (args: { where: { duplicate_of_sale_id?: unknown } }) =>
      args.where.duplicate_of_sale_id
        ? [{ id: 's1', sale_code: 'x', customer_name: 'Jane', duplicate_of_sale_id: 'orig', duplicate_reason: 'address', rep: { field_manager_id: null } }]
        : [{ id: 'orig', sale_code: '2026-07-01-VF', customer_name: 'Someone Else', street: '1 Street', city: 'TOWN', mpu_id: null }],
    );
    await service.create(createDto, authUser('rep-self'));
    const data = (prisma.sale.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ duplicate_of_sale_id: 'orig', duplicate_reason: 'address', status: 'entered' });
    expect(emitter.emitRole).toHaveBeenCalledWith('Admin', expect.objectContaining({
      body: expect.stringContaining('the same address'),
    }));
  });
});

describe('SalesService.createWithinTx (composable inside the Import commit — IMP-013)', () => {
  type Data = {
    sale_code: string;
    status: string;
    import_batch_id?: string;
    sale_items: { create: Array<Record<string, unknown>> };
  };
  const dataArg = (tx: ReturnType<typeof make>['tx']): Data =>
    (tx.sale.create.mock.calls[0][0] as { data: Data }).data;

  const arrange = (behaviour: 'internet' | 'standard_addon' = 'internet') => {
    const h = make(ALL);
    h.tx.rep.findUnique.mockResolvedValue({ status: 'active' });
    h.tx.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, client_code: 'VF' });
    h.tx.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: behaviour === 'internet' ? 'internet' : 'tv', is_active: true, product_type_ref: { behaviour } },
    ]);
    h.tx.sale.create.mockResolvedValue({ id: 's1', sale_code: 'x', sale_items: [] });
    return h;
  };
  const dto = { ...createDto, rep_id: 'rep-1', sale_date: '2026-07-06' };

  it('writes through the CALLER’s tx (never this.prisma) and records import provenance', async () => {
    const { service, prisma, tx } = arrange();
    await service.createWithinTx(tx as never, dto, authUser(null), { importBatchId: 'batch-9' });

    expect(tx.sale.create).toHaveBeenCalled();
    expect(prisma.sale.create).not.toHaveBeenCalled(); // nothing escapes the batch transaction
    expect(dataArg(tx).import_batch_id).toBe('batch-9'); // IMP-008 provenance
    expect(dataArg(tx).status).toBe('validated'); // live sale, validated at submit (2026-11-28) — NOT 'historical'
  });

  it('leaves commission snapshots NULL — importing a sale writes NO commission (#2/#5)', async () => {
    const { service, tx } = arrange();
    await service.createWithinTx(tx as never, dto, authUser(null));

    const item = dataArg(tx).sale_items.create[0];
    expect(item.counts_toward_tally).toBe(true); // internet, not greenfield → counts toward the tier tally
    expect(item).not.toHaveProperty('tier_at_payment');
    expect(item).not.toHaveProperty('rate_applied');
    expect(item).not.toHaveProperty('commission_paid');
    expect(item).not.toHaveProperty('incentive_amount');
  });

  it('enforces SALE-001a inside the tx — an add-on-only sale is rejected and nothing is written', async () => {
    const { service, tx } = arrange('standard_addon');
    await expect(service.createWithinTx(tx as never, dto, authUser(null))).rejects.toMatchObject({
      status: 422,
    });
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('resolves the sale_code suffix from a count ON the tx, so same-batch siblings are visible', async () => {
    const { service, prisma, tx } = arrange();
    tx.sale.count.mockResolvedValue(1); // one sibling already created earlier in THIS batch
    await service.createWithinTx(tx as never, dto, authUser(null));

    expect(tx.sale.count).toHaveBeenCalled();
    expect(prisma.sale.count).not.toHaveBeenCalled();
    expect(dataArg(tx).sale_code).toBe('2026-07-06-VF-1');
  });

  it('does NOT audit — the caller logs after the batch commits (mirrors validateWithinTx)', async () => {
    const { service, tx, audit } = arrange();
    await service.createWithinTx(tx as never, dto, authUser(null));
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('SalesService.validate (gate; never changes pay period)', () => {
  it('entered → validated sets validator + leaves sale_date untouched', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue({
      id: 's1',
      status: 'entered',
      is_greenfield: false,
      sale_date: new Date('2026-01-10T00:00:00Z'),
      sale_items: [],
    });
    tx.sale.update.mockResolvedValue({ id: 's1', status: 'validated', is_greenfield: false });

    await service.validate('s1', {}, authUser(null));

    const arg = tx.sale.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBe('validated');
    expect(arg.data.validated_by).toBe('user-1');
    expect(arg.data).not.toHaveProperty('sale_date'); // pay period cannot change (#7/SALE-010)
  });

  it('rejects validating a non-entered sale (409)', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue({
      id: 's1',
      status: 'validated',
      is_greenfield: false,
      sale_items: [],
    });
    await expect(service.validate('s1', {}, authUser(null))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SalesService.remove (soft delete)', () => {
  it('entered → status=deleted (no hard delete)', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue({ id: 's1', status: 'entered', sale_items: [] });
    prisma.sale.update.mockResolvedValue({ id: 's1', status: 'deleted' });
    await service.remove('s1', authUser(null));
    expect(prisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'deleted' } }),
    );
    expect((prisma.sale as Record<string, unknown>).delete).toBeUndefined();
  });

  it('rejects deleting a sale already in a pay run (409)', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue({ id: 's1', status: 'in_pay_run', sale_items: [] });
    await expect(service.remove('s1', authUser(null))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SalesService.setGreenfield (two-step; recomputes counts)', () => {
  it('confirming greenfield recomputes counts_toward_tally on internet items', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue({
      id: 's1',
      status: 'validated',
      is_greenfield: false,
      sale_items: [],
    });
    tx.sale.findUniqueOrThrow.mockResolvedValue({ id: 's1', is_greenfield: true, sale_items: [] });

    await service.setGreenfield('s1', { is_greenfield: true }, authUser(null));

    expect(tx.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_greenfield: true } }),
    );
    expect(tx.saleItem.updateMany).toHaveBeenCalledWith({
      where: { sale_id: 's1', product_type: 'internet' },
      data: { counts_toward_tally: false }, // greenfield → internet no longer counts
    });
  });

  it('rejects greenfield changes once the sale is in a pay run (409)', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue({
      id: 's1',
      status: 'in_pay_run',
      is_greenfield: false,
      sale_items: [],
    });
    await expect(
      service.setGreenfield('s1', { is_greenfield: true }, authUser(null)),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SalesService.list (scoping in the query)', () => {
  it('a manager’s list is filtered to their roster rep_ids', async () => {
    const { service, prisma } = make({ level: 'roster', repIds: ['r1', 'r2'] });
    await service.list({}, authUser(null));
    const arg = prisma.sale.findMany.mock.calls[0][0] as { where: { AND?: unknown[] } };
    expect(arg.where.AND).toEqual(expect.arrayContaining([{ rep_id: { in: ['r1', 'r2'] } }]));
  });

  it('an admin (scope all) applies no rep_id restriction', async () => {
    const { service, prisma } = make(ALL);
    await service.list({}, authUser(null));
    const arg = prisma.sale.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({}); // unrestricted
  });
});

// ── Client meeting 2026-11-16 ────────────────────────────────────────────────────────────────────

const daysAgo = (n: number): Date => {
  const d = new Date(`${todayInWinnipeg()}T18:00:00.000Z`); // midday Winnipeg, so the day is unambiguous
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

const baseSale = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  sale_code: '2026-11-14-VF',
  sale_date: new Date('2026-11-14T00:00:00.000Z'),
  status: 'entered',
  rep_id: 'rep-self',
  client_id: 'c1',
  customer_name: 'Jane Doe',
  customer_first_name: 'Jane',
  customer_last_name: 'Doe',
  street: '1 St',
  city: 'Winnipeg',
  province_state: 'MB',
  postal_code: 'R0R0R0',
  activation_date: null,
  is_greenfield: false,
  duplicate_of_sale_id: null,
  duplicate_approved_at: null,
  created_at: daysAgo(1),
  sale_items: [{ id: 'i1', product_id: 'p1', product_type: 'internet', rate_applied: null, commission_paid: null }],
  ...over,
});

describe('possible duplicates are held until approved (2026-11-16)', () => {
  it('validate refuses an unapproved duplicate with 422, naming the original', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ duplicate_of_sale_id: 'orig' }));
    tx.sale.findUnique.mockResolvedValue({ sale_code: '2026-07-03-VF' });
    await expect(service.validate('s1', {}, authUser(null))).rejects.toMatchObject({
      code: 'SALE_DUPLICATE_UNAPPROVED',
      message: expect.stringContaining('2026-07-03-VF'),
    });
    expect(tx.sale.update).not.toHaveBeenCalled();
  });

  it('validate proceeds once the duplicate is approved', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ duplicate_of_sale_id: 'orig', duplicate_approved_at: new Date() }));
    tx.sale.update.mockResolvedValue({ id: 's1', status: 'validated', is_greenfield: false, rep_id: 'r' });
    await service.validate('s1', {}, authUser(null));
    expect(tx.sale.update).toHaveBeenCalled();
  });

  it('bulk-validate reports the held duplicate as a failure instead of throwing', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ duplicate_of_sale_id: 'orig' }));
    const res = await service.bulkValidate({ sale_ids: ['s1'] }, authUser(null));
    expect(res).toMatchObject({ validated: 0, failed: 1 });
  });

  it('approveDuplicate stamps who/when and audits; a sale that is not flagged is a 409', async () => {
    const { service, prisma, audit } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ duplicate_of_sale_id: 'orig' }));
    prisma.sale.update.mockResolvedValue(baseSale({ duplicate_of_sale_id: 'orig', duplicate_approved_at: new Date() }));
    await service.approveDuplicate('s1', authUser(null));
    const arg = prisma.sale.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.duplicate_approved_by).toBe('user-1');
    // Approving IS the review: a held (entered) sale is validated in the same write. — 2026-11-28
    expect(arg.data).toMatchObject({ status: 'validated', validated_by: 'user-1' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve_duplicate' }));

    prisma.sale.findFirst.mockResolvedValue(baseSale());
    await expect(service.approveDuplicate('s1', authUser(null))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SalesService.edit (the 5-day window, 2026-11-16)', () => {
  it('applies a changed address directly and audits only the changed fields', async () => {
    const { service, prisma, tx, audit } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    await service.edit('s1', { street: '9 New Rd', city: 'Winnipeg' }, authUser(null));
    const arg = tx.sale.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.street).toBe('9 New Rd');
    expect(arg.data.city).toBeUndefined(); // unchanged, so not written
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', after: { street: '9 New Rd' } }));
  });

  it('allows a validated sale, keeping it validated', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ status: 'validated' }));
    await service.edit('s1', { street: '9 New Rd' }, authUser(null));
    const arg = tx.sale.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('status');
  });

  it('refuses after the window (6 days) with 422', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ created_at: daysAgo(6) }));
    await expect(service.edit('s1', { street: '9 New Rd' }, authUser(null))).rejects.toMatchObject({
      code: 'SALE_EDIT_WINDOW_CLOSED',
    });
  });

  it('accepts the last day of the window (5 days)', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ created_at: daysAgo(5) }));
    await service.edit('s1', { street: '9 New Rd' }, authUser(null));
    expect(tx.sale.update).toHaveBeenCalled();
  });

  it.each(['in_pay_run', 'paid', 'clawed_back', 'historical', 'deleted'])('refuses a %s sale', async (status) => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale({ status }));
    await expect(service.edit('s1', { street: '9 New Rd' }, authUser(null))).rejects.toMatchObject({
      code: 'SALE_EDIT_WINDOW_CLOSED',
    });
  });

  it('re-runs the entry rules on a new product list (SALE-001a) and adds only the new items', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    tx.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: 'internet', is_active: true, product_type_ref: { behaviour: 'internet' } },
      { id: 'p2', product_type: 'tv', is_active: true, product_type_ref: { behaviour: 'standard_addon' } },
    ]);
    await service.edit('s1', { items: [{ product_id: 'p1' }, { product_id: 'p2' }] }, authUser(null));
    expect(tx.saleItem.deleteMany).not.toHaveBeenCalled(); // p1 kept
    const created = (tx.saleItem.createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> }).data;
    expect(created).toEqual([
      expect.objectContaining({ sale_id: 's1', product_id: 'p2', product_type: 'tv', counts_toward_tally: false }),
    ]);
    expect(created[0]).not.toHaveProperty('rate_applied'); // snapshots stay NULL (#2)

    // An add-on-only list is rejected.
    tx.product.findMany.mockResolvedValue([
      { id: 'p2', product_type: 'tv', is_active: true, product_type_ref: { behaviour: 'standard_addon' } },
    ]);
    await expect(service.edit('s1', { items: [{ product_id: 'p2' }] }, authUser(null))).rejects.toMatchObject({
      status: 422,
    });
  });

  it('a greenfield change recomputes counts_toward_tally on the internet item', async () => {
    const { service, prisma, tx } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    await service.edit('s1', { is_greenfield: true }, authUser(null));
    expect(tx.saleItem.updateMany).toHaveBeenCalledWith({
      where: { sale_id: 's1', product_type: 'internet' },
      data: { counts_toward_tally: false },
    });
  });

  it('"nothing changed" is a 422', async () => {
    const { service, prisma } = make(ALL);
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    await expect(service.edit('s1', { street: '1 St' }, authUser(null))).rejects.toMatchObject({
      code: 'SALE_EDIT_NO_CHANGES',
    });
  });
});

describe('rep edit requests (2026-11-16)', () => {
  it('stores ONLY the changed fields as a pending request and notifies the approvers', async () => {
    const { service, prisma, emitter } = make(SELF);
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    prisma.rep.findUnique.mockResolvedValue({ field_manager_id: 'mgr-1' });
    prisma.saleEditRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'er1',
      ...data,
      note: null,
      decided_by: null,
      decided_at: null,
      created_at: new Date(),
    }));
    await service.requestEdit('s1', { street: '9 New Rd', city: 'Winnipeg' }, authUser('rep-self'));
    const data = (prisma.saleEditRequest.create.mock.calls[0][0] as { data: { changes: unknown; status: string } }).data;
    expect(data.changes).toEqual({ street: '9 New Rd' });
    expect(data.status).toBe('pending');
    expect(emitter.emitMany).toHaveBeenCalledWith(['mgr-1'], expect.objectContaining({ eventType: 'sale_edit_requested' }));
    expect(emitter.emitRole).toHaveBeenCalledWith('Admin', expect.objectContaining({ eventType: 'sale_edit_requested' }));
    expect(prisma.sale.update).not.toHaveBeenCalled(); // nothing applied yet
  });

  it('refuses a request for another rep sale (403) and outside the window (422)', async () => {
    const { service, prisma } = make({ level: 'roster', repIds: ['rep-self', 'rep-2'] });
    prisma.sale.findFirst.mockResolvedValue(baseSale({ rep_id: 'rep-2' }));
    await expect(service.requestEdit('s1', { street: 'x' }, authUser('rep-self'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prisma.sale.findFirst.mockResolvedValue(baseSale({ created_at: daysAgo(9) }));
    await expect(service.requestEdit('s1', { street: 'x' }, authUser('rep-self'))).rejects.toMatchObject({
      code: 'SALE_EDIT_WINDOW_CLOSED',
    });
  });

  it('approving applies the stored changes in a transaction and tells the rep', async () => {
    const { service, prisma, tx, emitter } = make(ALL);
    const req = { id: 'er1', sale_id: 's1', status: 'pending', changes: { street: '9 New Rd' }, requested_by: 'rep-user' };
    tx.saleEditRequest.findUnique.mockResolvedValue(req);
    tx.saleEditRequest.update.mockResolvedValue({
      ...req,
      status: 'approved',
      note: null,
      decided_by: 'user-1',
      decided_at: new Date(),
      created_at: new Date(),
    });
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    await service.approveEditRequest('er1', undefined, authUser(null));
    expect((tx.sale.update.mock.calls[0][0] as { data: Record<string, unknown> }).data.street).toBe('9 New Rd');
    expect(emitter.emitMany).toHaveBeenCalledWith(['rep-user'], expect.objectContaining({ eventType: 'sale_edit_decided' }));
  });

  it('approving after the window closed is refused and nothing is marked approved', async () => {
    const { service, prisma, tx } = make(ALL);
    tx.saleEditRequest.findUnique.mockResolvedValue({
      id: 'er1',
      sale_id: 's1',
      status: 'pending',
      changes: { street: '9 New Rd' },
      requested_by: 'rep-user',
    });
    prisma.sale.findFirst.mockResolvedValue(baseSale({ created_at: daysAgo(7) }));
    await expect(service.approveEditRequest('er1', undefined, authUser(null))).rejects.toMatchObject({
      code: 'SALE_EDIT_WINDOW_CLOSED',
    });
    expect(tx.saleEditRequest.update).not.toHaveBeenCalled();
  });

  it('rejecting records the note and tells the rep; a decided request cannot be decided again', async () => {
    const { service, prisma, emitter } = make(ALL);
    const req = { id: 'er1', sale_id: 's1', status: 'pending', changes: {}, requested_by: 'rep-user' };
    prisma.saleEditRequest.findUnique.mockResolvedValue(req);
    prisma.saleEditRequest.update.mockResolvedValue({
      ...req,
      status: 'rejected',
      note: 'wrong',
      decided_by: 'user-1',
      decided_at: new Date(),
      created_at: new Date(),
    });
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    await service.rejectEditRequest('er1', 'wrong', authUser(null));
    expect(emitter.emitMany).toHaveBeenCalledWith(
      ['rep-user'],
      expect.objectContaining({ variables: expect.objectContaining({ decision: 'rejected', note: 'wrong' }) }),
    );

    prisma.saleEditRequest.findUnique.mockResolvedValue({ id: 'er1', status: 'approved' });
    await expect(service.rejectEditRequest('er1', undefined, authUser(null))).rejects.toBeInstanceOf(ConflictException);
  });
});
