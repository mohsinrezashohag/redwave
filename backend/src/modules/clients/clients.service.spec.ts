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
      $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return { service: new ClientsService(prisma as never, audit as never), prisma, audit, tx };
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
});
