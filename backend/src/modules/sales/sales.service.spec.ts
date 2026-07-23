import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

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
      findFirst: saleFindFirst,
      // createWithinTx writes + counts through the CALLER's tx (Import commit).
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    saleItem: { updateMany: jest.fn() },
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
      { id: 'p1', product_type: 'internet', is_active: true, product_type_ref: { behaviour: 'tiered' } },
    ]);
    prisma.sale.create.mockResolvedValue({ id: 's1', sale_code: 'x', sale_items: [] });

    await service.create(createDto, authUser('rep-self'));

    const arg = prisma.sale.create.mock.calls[0][0] as {
      data: {
        sale_code: string;
        rep_id: string;
        status: string;
        sale_items: { create: Array<Record<string, unknown>> };
      };
    };
    expect(arg.data.rep_id).toBe('rep-self'); // defaulted to caller
    expect(arg.data.status).toBe('entered');
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
    // Only a TV add-on (standard_addon) — no tiered/greenfield internet base.
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
      { id: 'p1', product_type: 'internet', is_active: true, product_type_ref: { behaviour: 'tiered' } },
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

describe('SalesService.createWithinTx (composable inside the Import commit — IMP-013)', () => {
  type Data = {
    sale_code: string;
    status: string;
    import_batch_id?: string;
    sale_items: { create: Array<Record<string, unknown>> };
  };
  const dataArg = (tx: ReturnType<typeof make>['tx']): Data =>
    (tx.sale.create.mock.calls[0][0] as { data: Data }).data;

  const arrange = (behaviour: 'tiered' | 'standard_addon' = 'tiered') => {
    const h = make(ALL);
    h.tx.rep.findUnique.mockResolvedValue({ status: 'active' });
    h.tx.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, client_code: 'VF' });
    h.tx.product.findMany.mockResolvedValue([
      { id: 'p1', product_type: behaviour === 'tiered' ? 'internet' : 'tv', is_active: true, product_type_ref: { behaviour } },
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
    expect(dataArg(tx).status).toBe('entered'); // live sale — NOT 'historical'
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
