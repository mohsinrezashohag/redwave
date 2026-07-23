import { UnprocessableEntityException } from '@nestjs/common';
import { TierScheduleService } from './tier-schedule.service';
import { DomainError } from '../../common/errors/domain-error';
import { SCHEDULE_C_V2 } from './schedule-c-v2';

function make() {
  const tx = {
    commissionTier: { deleteMany: jest.fn() },
    commissionTierConfig: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    commissionTierConfig: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    // Scope validation reads the client (unknown/inactive → 422, never a silent global write).
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'VF', is_active: true }) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new TierScheduleService(prisma as never, audit as never), prisma, audit, tx };
}

const monthsFromToday = (n: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const tiersDto = SCHEDULE_C_V2.tiers.map((t) => ({
  tier_number: t.tier_number,
  min_count: t.min_count,
  max_count: t.max_count,
  rate_per_activation: t.rate_per_activation,
}));

describe('TierScheduleService.create (COMM-001 / COMM-006)', () => {
  it('rejects a back-dated schedule (422)', async () => {
    const { service } = make();
    await expect(
      service.create({ effective_from: iso(monthsFromToday(-1)), tiers: tiersDto }, 'actor'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an invalid (non-contiguous) schedule as a DomainError (→ 422 via the global filter)', async () => {
    const { service } = make();
    const bad = [
      { tier_number: 1, min_count: 0, max_count: 5, rate_per_activation: '110.00' },
      { tier_number: 0, min_count: 8, max_count: null, rate_per_activation: '160.00' }, // gap at 6-7
    ];
    const err = await service
      .create({ effective_from: iso(monthsFromToday(1)), tiers: bad }, 'actor')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('TIER_SCHEDULE_INVALID');
  });

  it('supersedes the pending schedule (incl. child tiers), bounds current, and passes rate as a decimal string', async () => {
    const { service, prisma, tx } = make();
    prisma.commissionTierConfig.findMany.mockResolvedValue([
      { id: 'cur', effective_from: monthsFromToday(-1), effective_to: null }, // current/open
      { id: 'pend', effective_from: monthsFromToday(1), effective_to: null }, // pending
    ]);
    tx.commissionTierConfig.create.mockResolvedValue({
      id: 'new',
      effective_from: monthsFromToday(2),
      effective_to: null,
      tiers: [],
    });

    await service.create({ effective_from: iso(monthsFromToday(2)), tiers: tiersDto }, 'actor');

    expect(tx.commissionTier.deleteMany).toHaveBeenCalledWith({
      where: { tier_config_id: { in: ['pend'] } },
    });
    expect(tx.commissionTierConfig.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pend'] } },
    });
    expect(tx.commissionTierConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cur' } }),
    );
    const arg = tx.commissionTierConfig.create.mock.calls[0][0] as {
      data: { tiers: { create: Array<{ rate_per_activation: unknown }> } };
    };
    expect(arg.data.tiers.create[0].rate_per_activation).toBe('110.00');
    expect(typeof arg.data.tiers.create[0].rate_per_activation).toBe('string');
  });
});

/**
 * Per-client scope: a client's ladder and the GLOBAL one (client_id null) are INDEPENDENT effective-dated
 * streams. Supersession must never cross scopes — a VF schedule bounding the global row would silently
 * change every other client's pay. — CLAUDE #10
 */
describe('TierScheduleService — per-client scope isolation', () => {
  it('create scopes the supersession read to the client (never sees the global rows)', async () => {
    const { service, prisma, tx } = make();
    tx.commissionTierConfig.create.mockResolvedValue({ id: 'new', effective_from: monthsFromToday(1), effective_to: null, tiers: [] });

    await service.create({ client_id: 'VF', effective_from: iso(monthsFromToday(1)), tiers: tiersDto }, 'actor');

    expect(prisma.commissionTierConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { client_id: 'VF' } }),
    );
    const arg = tx.commissionTierConfig.create.mock.calls[0][0] as { data: { client_id: unknown } };
    expect(arg.data.client_id).toBe('VF');
  });

  it('create with no client_id writes the GLOBAL row and reads only global rows', async () => {
    const { service, prisma, tx } = make();
    tx.commissionTierConfig.create.mockResolvedValue({ id: 'new', effective_from: monthsFromToday(1), effective_to: null, tiers: [] });

    await service.create({ effective_from: iso(monthsFromToday(1)), tiers: tiersDto }, 'actor');

    expect(prisma.commissionTierConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { client_id: null } }),
    );
    const arg = tx.commissionTierConfig.create.mock.calls[0][0] as { data: { client_id: unknown } };
    expect(arg.data.client_id).toBeNull();
    // The global write must not have consulted the clients table at all.
    expect(prisma.client.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown/inactive client scope (422) rather than writing global', async () => {
    const { service, tx, prisma } = make();
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ client_id: 'nope', effective_from: iso(monthsFromToday(1)), tiers: tiersDto }, 'actor'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.commissionTierConfig.create).not.toHaveBeenCalled();
  });

  it('update keeps the row in its own scope (client_id is immutable on edit)', async () => {
    const { service, prisma, tx } = make();
    const row = { id: 't1', client_id: 'VF', effective_from: monthsFromToday(1), effective_to: null };
    prisma.commissionTierConfig.findUnique.mockResolvedValue(row);
    tx.commissionTierConfig.update.mockResolvedValue({ ...row, tiers: [] });

    await service.update('t1', { effective_from: iso(monthsFromToday(2)) }, 'actor');

    expect(prisma.commissionTierConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { client_id: 'VF', id: { not: 't1' } } }),
    );
    const arg = tx.commissionTierConfig.update.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('client_id');
  });

  it('remove re-opens ONLY its own scope predecessor (never another client / the global row)', async () => {
    const { service, prisma, tx } = make();
    const from = monthsFromToday(1);
    prisma.commissionTierConfig.findUnique.mockResolvedValue({ id: 't1', client_id: 'VF', effective_from: from, effective_to: null });

    await service.remove('t1', 'actor');

    const where = (tx.commissionTierConfig.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.client_id).toBe('VF');
    expect(tx.commissionTierConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { effective_to: null } }),
    );
  });
});
