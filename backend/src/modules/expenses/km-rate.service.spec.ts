import { UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { KmRateService } from './km-rate.service';

const decLike = (s: string) => ({ toString: () => s });

function make() {
  const prisma = {
    kmRateConfig: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new KmRateService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('KmRateService.resolveRepRate (the money path)', () => {
  it('returns the DEFAULT $0.45 when no config row applies', async () => {
    const { service, prisma } = make();
    prisma.kmRateConfig.findMany.mockResolvedValue([]);
    const rate = await service.resolveRepRate('client-A', D('2026-03-10'));
    expect(rate).toBeInstanceOf(Decimal);
    expect(rate.toString()).toBe('0.45');
  });

  it('prefers the client-specific rate over the global rate', async () => {
    const { service, prisma } = make();
    prisma.kmRateConfig.findMany.mockResolvedValue([
      { id: 'g', client_id: null, rate_per_km: decLike('0.450'), effective_from: D('2026-01-01'), effective_to: null },
      { id: 'c', client_id: 'client-A', rate_per_km: decLike('0.500'), effective_from: D('2026-01-01'), effective_to: null },
    ]);
    const rate = await service.resolveRepRate('client-A', D('2026-03-10'));
    expect(rate.toString()).toBe('0.5');
  });

  it('queries only the REP stream for the client + global scope', async () => {
    const { service, prisma } = make();
    prisma.kmRateConfig.findMany.mockResolvedValue([]);
    await service.resolveRepRate('client-A', D('2026-03-10'));
    const where = (prisma.kmRateConfig.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.stream).toBe('rep');
    expect(where.OR).toEqual([{ client_id: null }, { client_id: 'client-A' }]);
  });
});

describe('KmRateService.create (effective-dated, back-date guarded)', () => {
  it('rejects a back-dated effective_from with 422 (#10)', async () => {
    const { service } = make();
    await expect(
      service.create({ stream: 'rep', rate_per_km: '0.500', effective_from: '2020-01-01' }, 'actor-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects effective_to before effective_from with 422', async () => {
    const { service } = make();
    await expect(
      service.create(
        { stream: 'rep', rate_per_km: '0.500', effective_from: '2099-06-01', effective_to: '2099-01-01' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
