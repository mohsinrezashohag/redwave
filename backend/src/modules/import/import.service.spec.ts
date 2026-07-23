import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ImportService } from './import.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { UploadedFile } from '../../common/storage/storage.service';

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

const file: UploadedFile = { buffer: Buffer.from('x'), originalname: 'r.csv', mimetype: 'text/csv', size: 1 };

function make(parseRows: Record<string, unknown>[] = [], headers: string[] = []) {
  const tx = {
    importRow: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    importBatch: { update: jest.fn() },
    clientBillingRate: { create: jest.fn().mockResolvedValue({ id: 'rate-1' }) },
    holdbackLedger: { create: jest.fn().mockResolvedValue({ id: 'hl-1' }) },
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', client_code: 'VF' }), create: jest.fn().mockResolvedValue({ id: 'c1' }), update: jest.fn() },
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }), create: jest.fn().mockResolvedValue({ id: 'p1' }) },
    rep: { findUnique: jest.fn().mockResolvedValue({ id: 'rep1' }), create: jest.fn().mockResolvedValue({ id: 'rep1' }) },
    sale: { create: jest.fn().mockResolvedValue({ id: 'sale-H' }), count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    importFieldMapping: { findUnique: jest.fn() },
    sale: { findMany: jest.fn().mockResolvedValue([]) },
    client: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    productTypeCatalogue: { findMany: jest.fn().mockResolvedValue([{ key: 'internet' }, { key: 'tv' }]) },
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
  const sales = {
    validateWithinTx: jest.fn().mockResolvedValue({ id: 'sale-A' }),
    createWithinTx: jest.fn().mockResolvedValue({ id: 'sale-L' }),
  };
  const parser = { parse: jest.fn().mockResolvedValue({ sheet: null, headers, rows: parseRows }) };
  const storage = { upload: jest.fn().mockResolvedValue({ path: 'imports/2026/x.csv', stored: true }) };
  const service = new ImportService(
    prisma as never,
    audit as never,
    sales as never,
    parser as never,
    storage as never,
    { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never,
  );
  return { service, prisma, tx, sales, parser, storage, audit };
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

describe('ImportService.stage (real parse → clean → classify)', () => {
  it('parses the file, cleans + classifies bulk-validation rows, stores the file, computes counts', async () => {
    const { service, prisma, storage } = make([{ 'MPU #': 'A' }, { 'MPU #': 'B' }, { 'MPU #': '' }], ['MPU #']);
    prisma.sale.findMany.mockResolvedValue([{ id: 'sale-A', mpu_id: 'A' }]); // one entered sale for MPU A
    const res = await service.stage(file, { source_type: 'client_report', import_type: 'sales', client_id: 'c1' } as never, user);
    expect(storage.upload).toHaveBeenCalledWith('imports', file);
    const data = (prisma.importBatch.create.mock.calls[0][0] as {
      data: { source_file_url: string; total_rows: number; matched_rows: number; import_rows: { create: { match_status: string; matched_entity_id: string | null }[] } };
    }).data;
    expect(data.source_file_url).toBe('imports/2026/x.csv'); // real stored path, not a stub
    expect(data.total_rows).toBe(3);
    expect(data.matched_rows).toBe(1);
    expect(data.import_rows.create.map((r) => r.match_status)).toEqual(['matched', 'unmatched', 'unmatched']);
    expect(data.import_rows.create[0].matched_entity_id).toBe('sale-A');
    expect(res.applied_mapping.mpu_id).toBe('MPU #'); // auto-suggested mapping returned
    expect(res.source_headers).toEqual(['MPU #']);
  });

  it('rejects an unsupported source/import pairing → 422', async () => {
    const { service } = make([{}], []);
    await expect(service.stage(file, { source_type: 'client_report', import_type: 'clients' } as never, user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('requires client_id for a client_report → 422', async () => {
    const { service } = make([{ mpu_id: 'A' }], []);
    await expect(service.stage(file, { source_type: 'client_report', import_type: 'sales' } as never, user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('ImportService.commit — gate + atomicity + idempotency (#8)', () => {
  it('blocks commit while any row is unresolved → 422', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(stagedBatch({ import_rows: [{ id: 'r1', match_status: 'unmatched', mapped_data: {} }] }));
    await expect(service.commit('b1', user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('drives Sales validation for matched bulk-validation rows; marks batch committed', async () => {
    const { service, prisma, tx, sales } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({ matched_rows: 1, import_rows: [{ id: 'r1', match_status: 'matched', matched_entity_id: 'sale-A', mapped_data: { mpu_id: 'A' } }] }),
    );
    await service.commit('b1', user);
    expect(sales.validateWithinTx).toHaveBeenCalledWith(tx, 'sale-A', {}, user);
    expect(tx.importBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'committed' }) }));
  });

  it('a forced mid-commit failure rolls back the ENTIRE batch (status never set committed)', async () => {
    const { service, prisma, tx, sales } = make();
    sales.validateWithinTx.mockRejectedValue(new Error('boom'));
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({ import_rows: [{ id: 'r1', match_status: 'matched', matched_entity_id: 'sale-A', mapped_data: { mpu_id: 'A' } }] }),
    );
    await expect(service.commit('b1', user)).rejects.toThrow('boom');
    expect(tx.importBatch.update).not.toHaveBeenCalled();
  });

  it('re-committing a committed batch is a no-op (idempotent)', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(stagedBatch({ status: 'committed' }));
    await service.commit('b1', user);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('committing a non-staged batch → 409', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(stagedBatch({ status: 'cancelled' }));
    await expect(service.commit('b1', user)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ImportService.commit — LIVE sales (sales_entry:sales — IMP-013)', () => {
  const row = {
    client_code: 'VF',
    rep_code: 'RW-D-0001',
    product_types: 'internet,tv',
    sale_date: '2026-07-06',
    customer_name: 'Jane Doe',
  };
  const liveBatch = (mapped: Record<string, unknown>) =>
    stagedBatch({
      source_type: 'sales_entry',
      import_type: 'sales',
      client_id: null,
      import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: mapped }],
    });

  it('DRIVES SalesService.createWithinTx inside the batch tx (never reimplements sale creation)', async () => {
    const { service, prisma, tx, sales } = make();
    tx.product.findFirst.mockResolvedValueOnce({ id: 'p-int' }).mockResolvedValueOnce({ id: 'p-tv' });
    prisma.importBatch.findUnique.mockResolvedValue(liveBatch(row));

    await service.commit('b1', user);

    expect(sales.createWithinTx).toHaveBeenCalledTimes(1);
    const [txArg, dto, , opts] = sales.createWithinTx.mock.calls[0] as [unknown, Record<string, unknown>, unknown, unknown];
    expect(txArg).toBe(tx); // atomic with the rest of the batch (#8)
    // ONE ROW = ONE SALE, with every listed product type as an item.
    expect(dto.items).toEqual([{ product_id: 'p-int' }, { product_id: 'p-tv' }]);
    expect(dto.customer_name).toBe('Jane Doe');
    expect(opts).toEqual({ importBatchId: 'b1' }); // provenance (IMP-008)
    expect(tx.sale.create).not.toHaveBeenCalled(); // the handler itself writes no sale row
  });

  it('blank status stays entered; "validated" ALSO runs the entered→validated transition', async () => {
    const entered = make();
    entered.prisma.importBatch.findUnique.mockResolvedValue(liveBatch(row));
    await entered.service.commit('b1', user);
    expect(entered.sales.validateWithinTx).not.toHaveBeenCalled();

    const validated = make();
    validated.prisma.importBatch.findUnique.mockResolvedValue(liveBatch({ ...row, status: 'validated' }));
    await validated.service.commit('b1', user);
    expect(validated.sales.validateWithinTx).toHaveBeenCalledWith(validated.tx, 'sale-L', {}, user);
  });

  it('optional address columns fall back to the “—” placeholder', async () => {
    const { service, prisma, sales } = make();
    prisma.importBatch.findUnique.mockResolvedValue(liveBatch(row));
    await service.commit('b1', user);
    const dto = sales.createWithinTx.mock.calls[0][1] as Record<string, string>;
    expect(dto.street).toBe('—');
    expect(dto.postal_code).toBe('—');
  });

  it('a product that vanished between staging and commit throws → the batch rolls back uncommitted', async () => {
    const { service, prisma, tx } = make();
    tx.product.findFirst.mockResolvedValue(null);
    prisma.importBatch.findUnique.mockResolvedValue(liveBatch(row));

    await expect(service.commit('b1', user)).rejects.toMatchObject({ code: 'IMPORT_PRODUCT_NOT_FOUND' });
    expect(tx.importBatch.update).not.toHaveBeenCalled(); // never marked committed
  });
});

describe('ImportService.commit — migration handlers', () => {
  it('back-dated billing rate (by code) is inserted via the transaction (no Clients 422)', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'master_migration',
        import_type: 'billing_rates',
        client_id: null,
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { client_code: 'VF', product_name: 'Internet', rate_kind: 'product', amount: '60.00', effective_from: '2025-01-01' } }],
      }),
    );
    await service.commit('b1', user);
    const data = (tx.clientBillingRate.create.mock.calls[0][0] as { data: { amount: string; effective_from: Date } }).data;
    expect(data.amount).toBe('60.00');
    expect(data.effective_from).toBeInstanceOf(Date); // back-dated 2025 — accepted via migration (#10)
  });

  it('HISTORICAL sale is created status=historical with historical_billed_amount + counts_toward_tally=false (never paid)', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'master_migration',
        import_type: 'sales',
        client_id: null,
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { client_code: 'VF', rep_code: 'RW-D-0001', product_type: 'internet', sale_date: '2025-03-12', billed_amount: '60.00' } }],
      }),
    );
    await service.commit('b1', user);
    const data = (tx.sale.create.mock.calls[0][0] as { data: { status: string; import_batch_id: string; sale_items: { create: { historical_billed_amount: string; counts_toward_tally: boolean; commission_paid?: unknown }[] } } }).data;
    expect(data.status).toBe('historical'); // reference-only — never enters the pay pipeline
    expect(data.import_batch_id).toBe('b1');
    const item = data.sale_items.create[0];
    expect(item.historical_billed_amount).toBe('60.00'); // billing-stream reference (#3)
    expect(item.counts_toward_tally).toBe(false); // never counts toward a tier tally (#5/#9)
    expect(item.commission_paid).toBeUndefined(); // NO commission snapshot (#2)
  });

  it('opening holdback: reconcile_total must match the staged sum (else 422)', async () => {
    const { service, prisma } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'balance_migration',
        import_type: 'holdback',
        client_id: null,
        reconcile_total: '900.00',
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { rep_code: 'RW-D-0001', origin_pay_period_id: 'p-old', amount_held: '993.00' } }],
      }),
    );
    await expect(service.commit('b1', user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('opening holdback (by rep_code): a reconciled balance → a scheduled ledger entry', async () => {
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
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { rep_code: 'RW-D-0001', origin_pay_period_id: 'p-old', amount_held: '993.00' } }],
      }),
    );
    await service.commit('b1', user);
    const data = (tx.holdbackLedger.create.mock.calls[0][0] as { data: { rep_id: string; amount_held: string; release_status: string; scheduled_release_period_id: string | null } }).data;
    expect(data.rep_id).toBe('rep1'); // resolved from rep_code
    expect(data.amount_held).toBe('993.00');
    expect(data.scheduled_release_period_id).toBe('p-new');
  });
});

describe('ImportService.reconcile / remap', () => {
  it('a manual match sets matched_entity_id and recomputes counts', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(stagedBatch({ import_rows: [{ id: 'r1', match_status: 'unmatched', mapped_data: { mpu_id: 'B' } }] }));
    tx.importRow.findMany.mockResolvedValue([{ match_status: 'matched' }]);
    await service.reconcile('b1', { resolutions: [{ row_id: 'r1', action: 'match', matched_entity_id: 'sale-B' } as never] }, user);
    expect(tx.importRow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ match_status: 'matched', matched_entity_id: 'sale-B' }) }));
    expect(tx.importBatch.update).toHaveBeenCalled();
  });

  it('remap re-applies a new mapping to the stored raw_data + re-classifies', async () => {
    const { service, prisma, tx } = make();
    prisma.sale.findMany.mockResolvedValue([{ id: 'sale-A', mpu_id: 'A' }]);
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({ import_rows: [{ id: 'r1', match_status: 'error', raw_data: { 'House ID': 'A' }, mapped_data: {} }] }),
    );
    await service.remap('b1', { mapping_json: { mpu_id: 'House ID' } }, user);
    expect(tx.importRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ match_status: 'matched', matched_entity_id: 'sale-A' }) }),
    );
  });
});
