import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ImportService } from './import.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user: AuthUser = {
  id: 'admin-1',
  email: 'a@x.co',
  full_name: 'Admin',
  status: 'active',
  roleNames: ['Admin'],
  isSuperAdmin: false,
  permissions: new Set(),
  repId: null,
};

function make() {
  const tx = {
    importRow: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    importBatch: { update: jest.fn() },
    clientBillingRate: { create: jest.fn().mockResolvedValue({ id: 'rate-1' }) },
    holdbackLedger: { create: jest.fn().mockResolvedValue({ id: 'hl-1' }) },
  };
  const prisma = {
    importFieldMapping: { findUnique: jest.fn() },
    sale: { findMany: jest.fn().mockResolvedValue([]) },
    client: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    rep: { findMany: jest.fn().mockResolvedValue([]) },
    payPeriod: { findMany: jest.fn().mockResolvedValue([]) },
    holdbackLedger: { findMany: jest.fn().mockResolvedValue([]) },
    holdbackReleaseSetting: { findFirst: jest.fn().mockResolvedValue({ release_rule: 'next_cycle_after_30_days' }) },
    importBatch: {
      create: jest.fn().mockResolvedValue({ id: 'b1', import_rows: [] }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const sales = { validateWithinTx: jest.fn().mockResolvedValue({ id: 'sale-A' }) };
  const service = new ImportService(prisma as never, audit as never, sales as never, { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never);
  return { service, prisma, tx, sales, audit };
}

const stagedBatch = (over: Record<string, unknown>) => ({
  id: 'b1',
  status: 'staged',
  source_type: 'client_report',
  import_type: 'sales',
  client_id: 'c1',
  reconcile_total: null,
  matched_rows: 0,
  import_rows: [],
  ...over,
});

describe('ImportService.stage', () => {
  it('classifies bulk-validation rows and computes counts', async () => {
    const { service, prisma } = make();
    prisma.sale.findMany.mockResolvedValue([{ id: 'sale-A', mpu_id: 'A' }]); // one entered sale for MPU A
    await service.stage(
      {
        source_type: 'client_report',
        import_type: 'sales',
        client_id: 'c1',
        rows: [{ mpu_id: 'A' }, { mpu_id: 'B' }, {}],
      } as never,
      user,
    );
    const data = (prisma.importBatch.create.mock.calls[0][0] as {
      data: { total_rows: number; matched_rows: number; import_rows: { create: { match_status: string; matched_entity_id: string | null }[] } };
    }).data;
    expect(data.total_rows).toBe(3);
    expect(data.matched_rows).toBe(1);
    expect(data.import_rows.create.map((r) => r.match_status)).toEqual(['matched', 'unmatched', 'unmatched']);
    expect(data.import_rows.create[0].matched_entity_id).toBe('sale-A');
  });

  it('rejects an unsupported source/import pairing (historical sales load deferred) → 422', async () => {
    const { service } = make();
    await expect(
      service.stage({ source_type: 'master_migration', import_type: 'sales', rows: [{}] } as never, user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('requires client_id for a client_report → 422', async () => {
    const { service } = make();
    await expect(
      service.stage({ source_type: 'client_report', import_type: 'sales', rows: [{ mpu_id: 'A' }] } as never, user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ImportService.commit — gate + atomicity + idempotency (#8)', () => {
  it('blocks commit while any row is unresolved → 422', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({ import_rows: [{ id: 'r1', match_status: 'unmatched', mapped_data: {} }] }),
    );
    await expect(service.commit('b1', user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('drives Sales validation for matched bulk-validation rows; marks batch committed', async () => {
    const { service, prisma, tx, sales } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        matched_rows: 1,
        import_rows: [{ id: 'r1', match_status: 'matched', matched_entity_id: 'sale-A', mapped_data: { mpu_id: 'A' } }],
      }),
    );
    await service.commit('b1', user);
    expect(sales.validateWithinTx).toHaveBeenCalledWith(tx, 'sale-A', {}, user);
    expect(tx.importBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'committed' }) }),
    );
  });

  it('a forced mid-commit failure rolls back the ENTIRE batch (status never set committed)', async () => {
    const { service, prisma, tx, sales } = make();
    sales.validateWithinTx.mockRejectedValue(new Error('boom'));
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        import_rows: [{ id: 'r1', match_status: 'matched', matched_entity_id: 'sale-A', mapped_data: { mpu_id: 'A' } }],
      }),
    );
    await expect(service.commit('b1', user)).rejects.toThrow('boom');
    expect(tx.importBatch.update).not.toHaveBeenCalled(); // batch stays staged — no partial import
  });

  it('re-committing a committed batch is a no-op (idempotent)', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(stagedBatch({ status: 'committed' }));
    await service.commit('b1', user);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('committing a non-staged (e.g. cancelled) batch → 409', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(stagedBatch({ status: 'cancelled' }));
    await expect(service.commit('b1', user)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ImportService.commit — migration handlers', () => {
  it('back-dated billing rate is inserted via the transaction (no Clients 422)', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'master_migration',
        import_type: 'clients',
        client_id: null,
        import_rows: [
          {
            id: 'r1',
            match_status: 'matched',
            mapped_data: { client_id: 'c1', product_id: 'p1', rate_kind: 'product', amount: '60.00', effective_from: '2025-01-01' },
          },
        ],
      }),
    );
    await service.commit('b1', user);
    const data = (tx.clientBillingRate.create.mock.calls[0][0] as { data: { amount: string; effective_from: Date } }).data;
    expect(data.amount).toBe('60.00');
    expect(data.effective_from).toBeInstanceOf(Date); // back-dated 2025 — accepted via migration (#10)
  });

  it('opening holdback: reconcile_total must match the staged sum (else 422)', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'balance_migration',
        import_type: 'holdback',
        client_id: null,
        reconcile_total: '900.00', // ≠ staged 993.00
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { rep_id: 'rep1', origin_pay_period_id: 'p-old', amount_held: '993.00' } }],
      }),
    );
    await expect(service.commit('b1', user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('opening holdback: a reconciled balance is written as a scheduled ledger entry', async () => {
    const { service, prisma, tx } = make();
    prisma.payPeriod.findMany.mockResolvedValue([
      { id: 'p-old', start_date: new Date('2025-12-01T00:00:00Z'), payday: new Date('2025-12-14T00:00:00Z') },
      { id: 'p-new', start_date: new Date('2026-01-04T00:00:00Z'), payday: new Date('2026-01-17T00:00:00Z') },
    ]);
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'balance_migration',
        import_type: 'holdback',
        client_id: null,
        reconcile_total: '993.00',
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { rep_id: 'rep1', origin_pay_period_id: 'p-old', amount_held: '993.00' } }],
      }),
    );
    await service.commit('b1', user);
    const data = (tx.holdbackLedger.create.mock.calls[0][0] as { data: { amount_held: string; release_status: string; scheduled_release_period_id: string | null } }).data;
    expect(data.amount_held).toBe('993.00');
    expect(data.release_status).toBe('scheduled');
    expect(data.scheduled_release_period_id).toBe('p-new'); // resolved to the first period ≥ origin payday + 30d
  });
});

describe('ImportService.reconcile', () => {
  it('a manual match sets matched_entity_id and recomputes counts', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({ import_rows: [{ id: 'r1', match_status: 'unmatched', mapped_data: { mpu_id: 'B' } }] }),
    );
    tx.importRow.findMany.mockResolvedValue([{ match_status: 'matched' }]);
    await service.reconcile('b1', { resolutions: [{ row_id: 'r1', action: 'match', matched_entity_id: 'sale-B' } as never] }, user);
    expect(tx.importRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ match_status: 'matched', matched_entity_id: 'sale-B' }) }),
    );
    expect(tx.importBatch.update).toHaveBeenCalled(); // recount
  });
});
