import { UnprocessableEntityException } from '@nestjs/common';
import { FlatRateService } from './flat-rate.service';

function make() {
  const tx = {
    commissionFlatRate: { deleteMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    commissionFlatRate: { findMany: jest.fn().mockResolvedValue([]) },
    // The flat-ratable check reads behaviour from the catalogue (default: a standard add-on).
    productTypeCatalogue: { findUnique: jest.fn().mockResolvedValue({ behaviour: 'standard_addon', is_active: true }) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new FlatRateService(prisma as never, audit as never), prisma, audit, tx };
}

const iso = (n: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

describe('FlatRateService.create (COMM-002)', () => {
  it('rejects a tiered product_type (e.g. internet — it is tiered, not flat) — 422', async () => {
    const { service, prisma } = make();
    prisma.productTypeCatalogue.findUnique.mockResolvedValue({ behaviour: 'tiered', is_active: true });
    await expect(
      service.create(
        { product_type: 'internet' as never, amount: '50.00', effective_from: iso(1) },
        'actor',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a back-dated effective_from (422)', async () => {
    const { service } = make();
    await expect(
      service.create(
        { product_type: 'tv' as never, amount: '30.00', effective_from: iso(-1) },
        'actor',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('passes amount as a decimal STRING and applies supersession for the product_type scope', async () => {
    const { service, prisma, tx } = make();
    prisma.commissionFlatRate.findMany.mockResolvedValue([
      { id: 'pend', effective_from: new Date(iso(1)), effective_to: null },
    ]);
    tx.commissionFlatRate.create.mockResolvedValue({
      id: 'new',
      product_type: 'tv',
      amount: '35.00',
      effective_from: new Date(iso(2)),
      effective_to: null,
    });

    await service.create(
      { product_type: 'tv' as never, amount: '35.00', effective_from: iso(2) },
      'actor',
    );

    const arg = tx.commissionFlatRate.create.mock.calls[0][0] as { data: { amount: unknown } };
    expect(arg.data.amount).toBe('35.00');
    expect(typeof arg.data.amount).toBe('string');
    expect(prisma.commissionFlatRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { product_type: 'tv' } }), // scope = product_type
    );
  });
});
