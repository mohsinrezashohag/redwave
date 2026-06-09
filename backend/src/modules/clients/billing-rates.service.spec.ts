import { UnprocessableEntityException } from '@nestjs/common';
import { BillingRatesService } from './billing-rates.service';
import { dateOnly, toUtcDateOnly } from './billing-rate.logic';

function make() {
  const tx = {
    clientBillingRate: { deleteMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }) },
    product: { findFirst: jest.fn() },
    clientBillingRate: { findMany: jest.fn().mockResolvedValue([]) },
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
