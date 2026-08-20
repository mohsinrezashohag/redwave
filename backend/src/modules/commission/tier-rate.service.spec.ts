/**
 * TierRateService — per-product rep tier rates.
 *
 * The tests that matter here are the ones about what this service must NOT reach: it configures a RATE for
 * a bracket, never the tally and never the bracket boundaries. Everything else is the shared effective-
 * dating machinery (#10), asserted at the scope key, because a scope key that is too loose is how one
 * product's rate would silently close another's.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TierRateService } from './tier-rate.service';

function make() {
  const tx = {
    commissionTierRate: {
      deleteMany: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'r1', effective_from: new Date(), effective_to: null }),
      create: jest.fn().mockResolvedValue({ id: 'new', effective_from: new Date(), effective_to: null }),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  const prisma = {
    commissionTierRate: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    // A tier rate prices a TIERED product; the behaviour comes from the catalogue via the product.
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ client_id: 'VF', product_type: 'internet', product_type_ref: { behaviour: 'tiered' } }),
    },
    // The bracket must exist in the schedule, else the rate could never be reached.
    commissionTier: { findFirst: jest.fn().mockResolvedValue({ id: 't2', tier_number: 2 }) },
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'VF', is_active: true }) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new TierRateService(prisma as never, audit as never), prisma, audit, tx };
}

const iso = (n: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

const dto = (over: Record<string, unknown> = {}) => ({
  product_id: 'prod-1gig',
  tier_number: 2,
  amount: '145.00',
  effective_from: iso(1),
  ...over,
}) as never;

describe('TierRateService.create', () => {
  it('persists the scope and passes amount as a decimal STRING, never a float (#1)', async () => {
    const { service, tx } = make();
    await service.create(dto(), 'actor');
    const arg = tx.commissionTierRate.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.product_id).toBe('prod-1gig');
    expect(arg.data.tier_number).toBe(2);
    expect(arg.data.amount).toBe('145.00');
    expect(typeof arg.data.amount).toBe('string');
  });

  // The scope key is the whole safety story: too loose and one rate closes another's window.
  it('scopes supersession to (client, product, tier) — all three', async () => {
    const { service, prisma } = make();
    await service.create(dto(), 'actor');
    expect(prisma.commissionTierRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { client_id: null, product_id: 'prod-1gig', tier_number: 2 } }),
    );
  });

  it("a client's rate is scoped to that client, never the cross-client one", async () => {
    const { service, prisma } = make();
    await service.create(dto({ client_id: 'VF' }), 'actor');
    expect(prisma.commissionTierRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { client_id: 'VF', product_id: 'prod-1gig', tier_number: 2 } }),
    );
  });

  // A rate on a flat-rated product would never resolve — it must fail loudly, not do nothing.
  it('rejects a non-tiered product (an add-on uses a flat rate) — 422', async () => {
    const { service, prisma } = make();
    prisma.product.findUnique.mockResolvedValue({ product_type: 'tv', product_type_ref: { behaviour: 'standard_addon' } });
    await expect(service.create(dto({ product_id: 'prod-tv' }), 'actor')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  // A product belongs to exactly one client, so a rate scoped elsewhere could never resolve — it would
  // look configured and pay nothing.
  it("rejects a client scope that does not own the product — 422", async () => {
    const { service, prisma } = make();
    prisma.client.findUnique.mockResolvedValue({ id: 'RF', is_active: true });
    await expect(service.create(dto({ client_id: 'RF' }), 'actor')).rejects.toThrow(/another client/);
  });

  it('accepts the client that DOES own the product', async () => {
    const { service, tx } = make();
    await service.create(dto({ client_id: 'VF' }), 'actor');
    const arg = tx.commissionTierRate.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.client_id).toBe('VF');
  });

  it('rejects an unknown product — 422', async () => {
    const { service, prisma } = make();
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.create(dto(), 'actor')).rejects.toThrow(/Unknown product/);
  });

  // A rate for a bracket the schedule never defines can never be reached by any tally.
  it('rejects a tier that no schedule defines — 422', async () => {
    const { service, prisma } = make();
    prisma.commissionTier.findFirst.mockResolvedValue(null);
    await expect(service.create(dto({ tier_number: 9 }), 'actor')).rejects.toThrow(/not defined/);
  });

  // #10 — a closed period is never rewritten.
  it('rejects a BACK-DATED effective_from — 422', async () => {
    const { service } = make();
    await expect(service.create(dto({ effective_from: iso(-1) }), 'actor')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('audits the create with its full scope', async () => {
    const { service, audit } = make();
    await service.create(dto(), 'actor');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'commission_tier_rates',
        action: 'create',
        after: expect.objectContaining({ product_id: 'prod-1gig', tier_number: 2, amount: '145.00' }),
      }),
    );
  });
});

describe('TierRateService.update / remove', () => {
  const pending = {
    id: 'r1',
    client_id: null,
    product_id: 'prod-1gig',
    tier_number: 2,
    amount: '145.00',
    effective_from: new Date(iso(1)),
    effective_to: null,
  };

  it('404s an unknown rate', async () => {
    const { service, prisma } = make();
    prisma.commissionTierRate.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { amount: '150.00' }, 'actor')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('edits only within the SAME scope, so a pending edit cannot bound another tier', async () => {
    const { service, prisma } = make();
    prisma.commissionTierRate.findUnique.mockResolvedValue(pending);
    await service.update('r1', { amount: '150.00' }, 'actor');
    expect(prisma.commissionTierRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { client_id: null, product_id: 'prod-1gig', tier_number: 2, id: { not: 'r1' } },
      }),
    );
  });

  it('deleting re-opens only its OWN scope predecessor', async () => {
    const { service, prisma, tx } = make();
    prisma.commissionTierRate.findUnique.mockResolvedValue(pending);
    await service.remove('r1', 'actor');
    const arg = tx.commissionTierRate.updateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual(
      expect.objectContaining({ client_id: null, product_id: 'prod-1gig', tier_number: 2 }),
    );
  });

  it('refuses to edit a CURRENT rate — supersede instead (#10)', async () => {
    const { service, prisma } = make();
    prisma.commissionTierRate.findUnique.mockResolvedValue({ ...pending, effective_from: new Date(iso(-2)) });
    await expect(service.update('r1', { amount: '150.00' }, 'actor')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
