import { UnprocessableEntityException } from '@nestjs/common';
import { FlatRateService } from './flat-rate.service';

function make() {
  const tx = {
    commissionFlatRate: { deleteMany: jest.fn(), update: jest.fn(), create: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  };
  const prisma = {
    commissionFlatRate: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    // The flat-ratable check reads behaviour from the catalogue (default: a standard add-on).
    productTypeCatalogue: { findUnique: jest.fn().mockResolvedValue({ behaviour: 'standard_addon', is_active: true }) },
    // Scope validation reads the client (unknown/inactive → 422, never a silent global write).
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'VF', is_active: true }) },
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
const monthsOut = (n: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
      // scope = (client_id, product_type); null client = the GLOBAL rate
      expect.objectContaining({ where: { client_id: null, product_type: 'tv' } }),
    );
  });
});

describe('FlatRateService.update / remove (pending-only — #10)', () => {
  const pending = () => ({ id: 'f1', product_type: 'tv', amount: '30.00', effective_from: monthsOut(1), effective_to: null });
  const current = () => ({ ...pending(), id: 'f2', effective_from: monthsOut(-1) });

  it('update edits a pending flat rate', async () => {
    const { service, prisma, tx } = make();
    prisma.commissionFlatRate.findUnique.mockResolvedValue(pending());
    tx.commissionFlatRate.update.mockResolvedValue({ ...pending(), amount: '33.00' });
    await service.update('f1', { amount: '33.00' }, 'actor');
    expect(tx.commissionFlatRate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1' }, data: expect.objectContaining({ amount: '33.00' }) }),
    );
  });

  it('update rejects a current flat rate (422 — supersede instead)', async () => {
    const { service, prisma } = make();
    prisma.commissionFlatRate.findUnique.mockResolvedValue(current());
    await expect(service.update('f2', { amount: '33.00' }, 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('remove deletes a pending flat rate and re-opens a bounded predecessor', async () => {
    const { service, prisma, tx } = make();
    prisma.commissionFlatRate.findUnique.mockResolvedValue(pending());
    await service.remove('f1', 'actor');
    expect(tx.commissionFlatRate.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(tx.commissionFlatRate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { effective_to: null } }));
  });

  it('remove rejects a current flat rate (422)', async () => {
    const { service, prisma } = make();
    prisma.commissionFlatRate.findUnique.mockResolvedValue(current());
    await expect(service.remove('f2', 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

/**
 * Per-client scope: the flat-rate scope is (client_id, product_type). A client's TV rate and the GLOBAL TV
 * rate are independent streams — supersession must never cross them. — CLAUDE #10
 */
describe('FlatRateService — per-client scope isolation', () => {
  it('create scopes supersession to (client, product_type) and persists client_id', async () => {
    const { service, prisma, tx } = make();
    tx.commissionFlatRate.create.mockResolvedValue({ id: 'new', product_type: 'tv', amount: '45.00', effective_from: monthsOut(1), effective_to: null });

    await service.create({ client_id: 'VF', product_type: 'tv' as never, amount: '45.00', effective_from: iso(1) }, 'actor');

    expect(prisma.commissionFlatRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { client_id: 'VF', product_type: 'tv' } }),
    );
    const arg = tx.commissionFlatRate.create.mock.calls[0][0] as { data: { client_id: unknown } };
    expect(arg.data.client_id).toBe('VF');
  });

  it('rejects an unknown/inactive client scope (422) rather than writing the global rate', async () => {
    const { service, prisma, tx } = make();
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ client_id: 'nope', product_type: 'tv' as never, amount: '45.00', effective_from: iso(1) }, 'actor'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.commissionFlatRate.create).not.toHaveBeenCalled();
  });

  it('remove re-opens ONLY its own (client, product_type) predecessor', async () => {
    const { service, prisma, tx } = make();
    prisma.commissionFlatRate.findUnique.mockResolvedValue({
      id: 'f1', client_id: 'VF', product_type: 'tv', amount: '45.00', effective_from: monthsOut(1), effective_to: null,
    });

    await service.remove('f1', 'actor');

    const where = (tx.commissionFlatRate.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.client_id).toBe('VF');
    expect(where.product_type).toBe('tv');
  });
});
