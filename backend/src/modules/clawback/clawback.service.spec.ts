import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ClawbackService } from './clawback.service';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user: AuthUser = {
  id: 'admin-1',
  email: 'a@x.co',
  full_name: 'Admin',
  status: 'active',
  roleNames: [],
  isSuperAdmin: true,
  permissions: new Set(),
  repId: null,
};

const decLike = (s: string) => ({ toString: () => s });

function make() {
  const tx = {
    clawback: { create: jest.fn().mockResolvedValue({ id: 'cb-1' }) },
    saleItem: { update: jest.fn() },
    sale: { update: jest.fn() },
  };
  const prisma = {
    saleItem: { findUnique: jest.fn() },
    clawback: { findFirst: jest.fn().mockResolvedValue(null) },
    rep: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = { getRepScope: jest.fn().mockResolvedValue({ level: 'all' }) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const service = new ClawbackService(
    prisma as never,
    audit as never,
    scope as never,
    new CommissionEngineService(), // the REAL engine clawback calc
    emitter as never,
  );
  return { service, prisma, tx };
}

// A frozen (paid) TV sale_item snapshot.
const paidTv = (incentive: string | null = null) => ({
  id: 'item-tv',
  item_status: 'active',
  rate_applied: decLike('30.00'),
  incentive_amount: incentive === null ? null : decLike(incentive),
  commission_paid: decLike(incentive === null ? '30.00' : '50.00'),
  sale: { id: 'sale-1', rep_id: 'rep-1' },
});

const base = { sale_item_id: 'item-tv', reason: 'cancelled', reported_date: '2026-03-15' };

describe('ClawbackService.enter (SRS §10)', () => {
  it('TV cancels → recovery $30 from the frozen snapshot; snapshot NOT mutated', async () => {
    const { service, prisma, tx } = make();
    prisma.saleItem.findUnique.mockResolvedValue(paidTv(null));

    await service.enter(base, user);

    expect((tx.clawback.create.mock.calls[0][0] as { data: { amount: string } }).data.amount).toBe(
      '30.00',
    );
    // immutability (#2): only item_status is written — never the snapshot fields
    const itemUpdate = (tx.saleItem.update.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(Object.keys(itemUpdate)).toEqual(['item_status']);
    expect(itemUpdate.item_status).toBe('clawed_back');
    expect(tx.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'clawed_back' } }),
    );
  });

  it('TV with a $20 incentive → recovery $50 (rate + incentive)', async () => {
    const { service, prisma, tx } = make();
    prisma.saleItem.findUnique.mockResolvedValue(paidTv('20.00'));
    await service.enter(base, user);
    expect((tx.clawback.create.mock.calls[0][0] as { data: { amount: string } }).data.amount).toBe(
      '50.00',
    );
  });

  it('amount defaults to the exact frozen amount; an explicit amount overrides it', async () => {
    const { service, prisma, tx } = make();
    prisma.saleItem.findUnique.mockResolvedValue(paidTv(null));
    await service.enter({ ...base, amount: '99.00' }, user);
    expect((tx.clawback.create.mock.calls[0][0] as { data: { amount: string } }).data.amount).toBe(
      '99.00',
    );
  });

  it('accepts a clawback entered "late" — reported_date is stored, drives no logic (#6)', async () => {
    const { service, prisma, tx } = make();
    prisma.saleItem.findUnique.mockResolvedValue(paidTv(null));
    await expect(
      service.enter({ ...base, reported_date: '2020-01-01' }, user),
    ).resolves.toBeDefined();
    expect(
      (tx.clawback.create.mock.calls[0][0] as { data: { reported_date: Date } }).data.reported_date,
    ).toBeInstanceOf(Date);
  });

  it('rejects clawing back an UNPAID item (no frozen snapshot) — 422', async () => {
    const { service, prisma } = make();
    prisma.saleItem.findUnique.mockResolvedValue({
      ...paidTv(null),
      commission_paid: null,
      rate_applied: null,
    });
    await expect(service.enter(base, user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a second clawback on the same item (409)', async () => {
    const { service, prisma } = make();
    prisma.saleItem.findUnique.mockResolvedValue(paidTv(null));
    prisma.clawback.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.enter(base, user)).rejects.toBeInstanceOf(ConflictException);
  });
});
