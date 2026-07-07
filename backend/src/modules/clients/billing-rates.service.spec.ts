import { UnprocessableEntityException } from '@nestjs/common';
import { BillingRatesService } from './billing-rates.service';
import { dateOnly, toUtcDateOnly } from './billing-rate.logic';

function make() {
  const tx = {
    clientBillingRate: { deleteMany: jest.fn(), update: jest.fn(), create: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }) },
    product: { findFirst: jest.fn() },
    clientBillingRate: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    // Every requested key is a known active catalogue type by default; a test overrides to simulate unknowns.
    productTypeCatalogue: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(where.key.in.map((key) => ({ key }))),
      ),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  return { service: new BillingRatesService(prisma as never, audit as never, emitter as never), prisma, audit, tx };
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const monthsFromToday = (n: number) => {
  const d = toUtcDateOnly(new Date());
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
};

describe('BillingRatesService.create', () => {
  it('passes amount to Prisma as the exact decimal STRING (never a number)', async () => {
    const { service, tx } = make();
    const from = iso(monthsFromToday(1));
    tx.clientBillingRate.create.mockResolvedValue({
      id: 'r1',
      amount: '49.99',
      effective_from: dateOnly(from),
      effective_to: null,
    });

    await service.create(
      'c1',
      { rate_kind: 'tv_addon' as never, amount: '49.99', effective_from: from },
      'actor',
    );

    const arg = tx.clientBillingRate.create.mock.calls[0][0] as { data: { amount: unknown } };
    expect(arg.data.amount).toBe('49.99');
    expect(typeof arg.data.amount).toBe('string'); // exact decimal string, not a float
  });

  it('rejects a back-dated effective_from with 422', async () => {
    const { service } = make();
    const past = iso(monthsFromToday(-1));
    await expect(
      service.create(
        'c1',
        { rate_kind: 'tv_addon' as never, amount: '10.00', effective_from: past },
        'actor',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects rate_kind=product without a product_id (422)', async () => {
    const { service } = make();
    const from = iso(monthsFromToday(1));
    await expect(
      service.create(
        'c1',
        { rate_kind: 'product' as never, amount: '10.00', effective_from: from },
        'actor',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a product_id that does not belong to the client (422)', async () => {
    const { service, prisma } = make();
    prisma.product.findFirst.mockResolvedValue(null);
    const from = iso(monthsFromToday(1));
    await expect(
      service.create(
        'c1',
        { product_id: 'p1', rate_kind: 'product' as never, amount: '10.00', effective_from: from },
        'actor',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('applies the supersession plan in a transaction (delete pending + bound current + create new)', async () => {
    const { service, prisma, tx } = make();
    prisma.clientBillingRate.findMany.mockResolvedValue([
      { id: 'cur', effective_from: monthsFromToday(-1), effective_to: null }, // current/open
      { id: 'pend', effective_from: monthsFromToday(1), effective_to: null }, // pending
    ]);
    const newFrom = iso(monthsFromToday(2));
    tx.clientBillingRate.create.mockResolvedValue({
      id: 'new',
      amount: '20.00',
      effective_from: dateOnly(newFrom),
      effective_to: null,
    });

    await service.create(
      'c1',
      { rate_kind: 'tv_addon' as never, amount: '20.00', effective_from: newFrom },
      'actor',
    );

    expect(tx.clientBillingRate.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pend'] } },
    });
    expect(tx.clientBillingRate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cur' } }),
    );
    expect(tx.clientBillingRate.create).toHaveBeenCalled();
  });
});

describe('BillingRatesService.create — bundle_bonus trigger (BILL-013)', () => {
  const from = () => iso(monthsFromToday(1));
  const bundleDto = (over: Record<string, unknown> = {}) =>
    ({ rate_kind: 'bundle_bonus' as never, amount: '35.00', effective_from: from(), bundle_product_types: ['tv', 'home_phone'], ...over });

  it('rejects a bundle_bonus with fewer than 2 distinct types (422)', async () => {
    const { service } = make();
    await expect(service.create('c1', bundleDto({ bundle_product_types: ['home_phone'] }), 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.create('c1', bundleDto({ bundle_product_types: ['tv', 'tv'] }), 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a bundle_bonus referencing an unknown/inactive product type (422)', async () => {
    const { service, prisma } = make();
    prisma.productTypeCatalogue.findMany.mockResolvedValue([{ key: 'tv' }]); // 'home_phone' not returned → inactive/unknown
    await expect(service.create('c1', bundleDto(), 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a bundle_bonus that targets a product_id (must be client-wide) (422)', async () => {
    const { service, prisma } = make();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1' });
    await expect(service.create('c1', bundleDto({ product_id: 'p1' }), 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects bundle_product_types on a non-bundle kind (422)', async () => {
    const { service } = make();
    await expect(
      service.create('c1', { rate_kind: 'tv_addon' as never, amount: '10.00', effective_from: from(), bundle_product_types: ['tv', 'home_phone'] }, 'actor'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('persists the trigger SORTED + scopes supersession to that trigger set (distinct bundles do not collide)', async () => {
    const { service, prisma, tx } = make();
    tx.clientBillingRate.create.mockResolvedValue({ id: 'r1', amount: '35.00', bundle_product_types: ['home_phone', 'tv'], effective_from: dateOnly(from()), effective_to: null });
    await service.create('c1', bundleDto({ bundle_product_types: ['tv', 'home_phone'] }), 'actor'); // unsorted in

    // The scope query for existing rows is narrowed to THIS bundle's (sorted) trigger set.
    expect(prisma.clientBillingRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ rate_kind: 'bundle_bonus', bundle_product_types: { equals: ['home_phone', 'tv'] } }) }),
    );
    // Stored sorted.
    const data = (tx.clientBillingRate.create.mock.calls[0][0] as { data: { bundle_product_types: string[] } }).data;
    expect(data.bundle_product_types).toEqual(['home_phone', 'tv']);
  });
});

describe('BillingRatesService.update / remove (pending-only — #10)', () => {
  const pending = () => ({
    id: 'r1',
    client_id: 'c1',
    product_id: 'p1',
    rate_kind: 'product',
    amount: '50.00',
    effective_from: monthsFromToday(1), // future → pending
    effective_to: null,
  });
  const current = () => ({ ...pending(), id: 'r2', effective_from: monthsFromToday(-1), effective_to: null });

  it('update edits a pending rate', async () => {
    const { service, prisma, tx } = make();
    prisma.clientBillingRate.findFirst.mockResolvedValue(pending());
    tx.clientBillingRate.update.mockResolvedValue({ ...pending(), amount: '55.00' });
    await service.update('c1', 'r1', { amount: '55.00' }, 'actor');
    expect(tx.clientBillingRate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ amount: '55.00' }) }),
    );
  });

  it('update rejects a current rate (422 — supersede instead)', async () => {
    const { service, prisma } = make();
    prisma.clientBillingRate.findFirst.mockResolvedValue(current());
    await expect(service.update('c1', 'r2', { amount: '55.00' }, 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('remove deletes a pending rate and re-opens any predecessor it bounded', async () => {
    const { service, prisma, tx } = make();
    prisma.clientBillingRate.findFirst.mockResolvedValue(pending());
    await service.remove('c1', 'r1', 'actor');
    expect(tx.clientBillingRate.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(tx.clientBillingRate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { effective_to: null } }));
  });

  it('remove rejects a current rate (422)', async () => {
    const { service, prisma } = make();
    prisma.clientBillingRate.findFirst.mockResolvedValue(current());
    await expect(service.remove('c1', 'r2', 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
