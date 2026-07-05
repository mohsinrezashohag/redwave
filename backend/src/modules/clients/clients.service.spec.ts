import { activeStatusWhere, ClientsService } from './clients.service';

describe('activeStatusWhere', () => {
  it('defaults to active only', () => {
    expect(activeStatusWhere(undefined)).toEqual({ is_active: true });
    expect(activeStatusWhere('active')).toEqual({ is_active: true });
  });
  it('inactive → is_active false', () => {
    expect(activeStatusWhere('inactive')).toEqual({ is_active: false });
  });
  it('all → no filter', () => {
    expect(activeStatusWhere('all')).toEqual({});
  });
});

describe('ClientsService', () => {
  function make() {
    const tx = {
      client: { update: jest.fn() },
      clientCustomField: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const prisma = {
      client: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      clientStatement: { findFirst: jest.fn().mockResolvedValue(null) },
      clientInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const currencies = { assertSupported: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new ClientsService(prisma as never, audit as never, currencies as never),
      prisma,
      audit,
      currencies,
      tx,
    };
  }

  it('list(active) excludes inactive clients via where is_active:true, returning a {data,meta} page', async () => {
    const { service, prisma } = make();
    prisma.client.findMany.mockResolvedValue([]);
    prisma.client.count.mockResolvedValue(0);
    const page = await service.findAll({ status: 'active' });
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } }),
    );
    expect(prisma.client.count).toHaveBeenCalledWith({ where: { is_active: true } });
    expect(page).toEqual({ data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 0 } });
  });

  it('deactivate is a SOFT update (is_active=false), never a delete', async () => {
    const { service, prisma, tx, audit } = make();
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true });
    tx.client.update.mockResolvedValue({ id: 'c1', is_active: false });

    await service.update('c1', { is_active: false }, 'actor');

    expect(tx.client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ is_active: false }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivate' }));
    // No custom_fields in the dto → the set is left untouched (no replace).
    expect(tx.clientCustomField.deleteMany).not.toHaveBeenCalled();
    // There is no delete on the mock — soft-deactivate must not attempt a hard delete (CLNT-006).
    expect((prisma.client as Record<string, unknown>).delete).toBeUndefined();
  });

  it('replaces the custom-field set in a transaction when provided', async () => {
    const { service, prisma, tx } = make();
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true });
    tx.client.update.mockResolvedValue({ id: 'c1' });

    await service.update('c1', { custom_fields: [{ field_name: 'AM', field_value: 'Jane' }] }, 'actor');

    expect(tx.clientCustomField.deleteMany).toHaveBeenCalledWith({ where: { client_id: 'c1' } });
    expect(tx.clientCustomField.createMany).toHaveBeenCalledWith({
      data: [{ field_name: 'AM', field_value: 'Jane', display_order: 0, client_id: 'c1' }],
    });
  });

  // ── Billing currency (Meeting 3, #12) ──────────────────────────────────────────────
  it('create persists the billing currency (USD) after validating it is supported', async () => {
    const { service, prisma, currencies } = make();
    prisma.client.create.mockResolvedValue({ id: 'c1', currency: 'USD' });
    await service.create(
      { client_code: 'CTI', name: 'CTI', market: 'US', currency: 'USD', supplies_mpu_id: true },
      'actor',
    );
    expect(currencies.assertSupported).toHaveBeenCalledWith('USD');
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'USD' }) }),
    );
  });

  it('create defaults to CAD without a currency-support check', async () => {
    const { service, prisma, currencies } = make();
    prisma.client.create.mockResolvedValue({ id: 'c1', currency: 'CAD' });
    await service.create({ client_code: 'VF', name: 'VF', market: 'CA', supplies_mpu_id: true }, 'actor');
    expect(currencies.assertSupported).not.toHaveBeenCalled(); // CAD is the base — no fetch
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'CAD' }) }),
    );
  });

  it('allows changing currency while the client has NO issued statement/invoice', async () => {
    const { service, prisma, tx } = make();
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, currency: 'CAD' });
    tx.client.update.mockResolvedValue({ id: 'c1', currency: 'USD' });
    await service.update('c1', { currency: 'USD' }, 'actor');
    expect(tx.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'USD' }) }),
    );
  });

  it('BLOCKS a currency change once an issued statement exists (frozen billing history, #12) → 422', async () => {
    const { service, prisma } = make();
    prisma.client.findUnique.mockResolvedValue({ id: 'c1', is_active: true, currency: 'CAD' });
    prisma.clientStatement.findFirst.mockResolvedValue({ id: 'stmt-1' }); // a doc is frozen in CAD
    await expect(service.update('c1', { currency: 'USD' }, 'actor')).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled(); // never reaches the write
  });
});
