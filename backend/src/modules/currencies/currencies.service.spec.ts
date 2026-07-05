import { UnprocessableEntityException } from '@nestjs/common';
import { CurrenciesService } from './currencies.service';

function make() {
  const prisma = { currency: { findMany: jest.fn(), findFirst: jest.fn() } };
  return { service: new CurrenciesService(prisma as never), prisma };
}

describe('CurrenciesService', () => {
  it('list returns the ACTIVE currencies ordered by code', async () => {
    const { service, prisma } = make();
    prisma.currency.findMany.mockResolvedValue([
      { code: 'CAD', name: 'Canadian Dollar', symbol: '$', is_active: true },
      { code: 'USD', name: 'US Dollar', symbol: '$', is_active: true },
    ]);
    const rows = await service.list();
    expect(prisma.currency.findMany).toHaveBeenCalledWith({ where: { is_active: true }, orderBy: { code: 'asc' } });
    expect(rows.map((r: { code: string }) => r.code)).toEqual(['CAD', 'USD']);
  });

  it('assertSupported passes for an active code', async () => {
    const { service, prisma } = make();
    prisma.currency.findFirst.mockResolvedValue({ code: 'USD' });
    await expect(service.assertSupported('USD')).resolves.toBeUndefined();
    expect(prisma.currency.findFirst).toHaveBeenCalledWith({ where: { code: 'USD', is_active: true }, select: { code: true } });
  });

  it('assertSupported → 422 for an unknown/inactive code', async () => {
    const { service, prisma } = make();
    prisma.currency.findFirst.mockResolvedValue(null);
    await expect(service.assertSupported('ZZZ')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
