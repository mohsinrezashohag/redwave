import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ProductTypeService } from './product-type.service';

function make() {
  const tx = {
    productTypeCatalogue: { create: jest.fn() },
    commissionFlatRate: { create: jest.fn() },
  };
  const prisma = {
    productTypeCatalogue: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new ProductTypeService(prisma as never, audit as never), prisma, audit, tx };
}

const future = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

describe('ProductTypeService', () => {
  it('forces behaviour=standard_addon for a new type (never tiered/greenfield)', async () => {
    const { service, tx } = make();
    tx.productTypeCatalogue.create.mockResolvedValue({ key: 'satellite', label: 'Satellite', behaviour: 'standard_addon' });
    await service.create({ key: 'satellite', label: 'Satellite' }, 'actor');
    expect(tx.productTypeCatalogue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ behaviour: 'standard_addon', is_system: false }) }),
    );
    expect(tx.commissionFlatRate.create).not.toHaveBeenCalled();
  });

  it('writes the inline commission flat rate in the same transaction', async () => {
    const { service, tx } = make();
    tx.productTypeCatalogue.create.mockResolvedValue({ key: 'satellite', label: 'Satellite' });
    await service.create(
      { key: 'satellite', label: 'Satellite', initial_flat_rate: { amount: '40.00', effective_from: future() } },
      'actor',
    );
    const arg = tx.commissionFlatRate.create.mock.calls[0][0] as { data: { product_type: string; amount: string } };
    expect(arg.data.product_type).toBe('satellite');
    expect(arg.data.amount).toBe('40.00');
  });

  it('rejects a duplicate key (409)', async () => {
    const { service, prisma } = make();
    prisma.productTypeCatalogue.findUnique.mockResolvedValue({ key: 'internet' });
    await expect(service.create({ key: 'internet', label: 'x' }, 'actor')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a back-dated inline rate (422) before creating anything', async () => {
    const { service, tx } = make();
    await expect(
      service.create({ key: 'satellite', label: 'x', initial_flat_rate: { amount: '40.00', effective_from: '2000-01-01' } }, 'actor'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.productTypeCatalogue.create).not.toHaveBeenCalled();
  });

  it('refuses to deactivate a system type (422)', async () => {
    const { service, prisma } = make();
    prisma.productTypeCatalogue.findUnique.mockResolvedValue({ key: 'internet', is_system: true, is_active: true });
    await expect(service.update('internet', { is_active: false }, 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
