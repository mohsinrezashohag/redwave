import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ImportService } from './import.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { UploadedFile } from '../../common/storage/storage.service';
// The REAL selectors the runtime uses, so the config-migration tests prove a round trip (write → read
// back for a past date) rather than only that a row was written.
import { selectKmRate } from '../expenses/km-rate.logic';
import { selectEffectiveRate } from '../../common/effective-dating';

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
    kmRateConfig: { create: jest.fn().mockResolvedValue({ id: 'km-1' }) },
    commissionTierConfig: { create: jest.fn().mockResolvedValue({ id: 'tier-cfg-1' }) },
    commissionFlatRate: { create: jest.fn().mockResolvedValue({ id: 'flat-1' }) },
    productTypeCatalogue: { findUnique: jest.fn().mockResolvedValue({ key: 'tv' }) },
    holdbackLedger: { create: jest.fn().mockResolvedValue({ id: 'hl-1' }) },
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', client_code: 'VF' }), create: jest.fn().mockResolvedValue({ id: 'c1' }), update: jest.fn() },
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }), create: jest.fn().mockResolvedValue({ id: 'p1' }) },
    // findFirst — reps resolve by rep_code OR the external_code alias.
    rep: {
      findUnique: jest.fn().mockResolvedValue({ id: 'rep1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'rep1' }),
      create: jest.fn().mockResolvedValue({ id: 'rep1' }),
    },
    sale: { create: jest.fn().mockResolvedValue({ id: 'sale-H' }), count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    importFieldMapping: { findUnique: jest.fn() },
    sale: { findMany: jest.fn().mockResolvedValue([]) },
    client: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    productTypeCatalogue: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'internet', label: 'Internet', behaviour: 'tiered' },
        { key: 'tv', label: 'TV', behaviour: 'standard_addon' },
        { key: 'home_phone', label: 'Home Phone', behaviour: 'standard_addon' },
      ]),
    },
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
    // First call = the MPU lookup; second = the no-MPU fallback candidate load (row 3 has no MPU). The
    // fallback row carries no customer/address here, so it correctly matches nothing.
    prisma.sale.findMany
      .mockResolvedValueOnce([{ id: 'sale-A', mpu_id: 'A' }]) // one entered sale for MPU A
      .mockResolvedValueOnce([
        { id: 'sale-A', sale_code: 'VF-1', customer_name: 'Jane Doe', street: '1 Main St', sale_date: new Date('2026-02-01T00:00:00Z'), activation_date: null },
      ]);
    const res = await service.stage(file, { source_type: 'client_report', import_type: 'sales', client_id: 'c1' } as never, user);
    expect(storage.upload).toHaveBeenCalledWith('imports', file);
    const data = (prisma.importBatch.create.mock.calls[0][0] as {
      data: {
        source_file_url: string;
        total_rows: number;
        matched_rows: number;
        applied_mapping: Record<string, string>;
        import_rows: { create: { match_status: string; matched_entity_id: string | null }[] };
      };
    }).data;
    expect(data.source_file_url).toBe('imports/2026/x.csv'); // real stored path, not a stub
    expect(data.total_rows).toBe(3);
    expect(data.matched_rows).toBe(1);
    expect(data.import_rows.create.map((r) => r.match_status)).toEqual(['matched', 'unmatched', 'unmatched']);
    expect(data.import_rows.create[0].matched_entity_id).toBe('sale-A');
    // PERSISTED, not merely returned — the detail screen reads it back instead of re-guessing a mapping
    // the server never applied.
    expect(data.applied_mapping.mpu_id).toBe('MPU #');
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
        import_rows: [{ id: 'r1', match_status: 'matched', mapped_data: { client_code: 'VF', rep_code: 'RW-D-0001', product_types: 'internet', sale_date: '2025-03-12', billed_amount: '60.00' } }],
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

  /**
   * The UAT-file shape: "Internet, TV, Home Phone" with ONE billed amount. The money rule is that the
   * amount is recorded exactly once, on the base item — so Σ over the sale equals the file's row total and
   * the Business dashboard cannot double-count (#1/#3).
   */
  it('HISTORICAL multi-type row → ONE sale, N items, billed amount ONCE on the base item', async () => {
    const { service, prisma, tx } = make();
    tx.product.findFirst
      .mockResolvedValueOnce({ id: 'p-int' })
      .mockResolvedValueOnce({ id: 'p-tv' })
      .mockResolvedValueOnce({ id: 'p-hp' });
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedBatch({
        source_type: 'master_migration',
        import_type: 'sales',
        client_id: null,
        import_rows: [
          {
            id: 'r1',
            match_status: 'matched',
            // Already canonicalised at stage time by the value vocabulary.
            mapped_data: { client_code: 'VF', rep_code: 'RW-D-0001', product_types: 'internet,tv,home_phone', sale_date: '2025-03-12', billed_amount: '450.00' },
          },
        ],
      }),
    );
    await service.commit('b1', user);

    expect(tx.sale.create).toHaveBeenCalledTimes(1); // ONE row = ONE sale, not one per product
    const data = (tx.sale.create.mock.calls[0][0] as { data: { sale_items: { create: { product_type: string; historical_billed_amount: string | null; counts_toward_tally: boolean }[] } } }).data;
    const items = data.sale_items.create;
    expect(items.map((i) => i.product_type)).toEqual(['internet', 'tv', 'home_phone']);
    expect(items.every((i) => i.counts_toward_tally === false)).toBe(true); // (#5/#9)

    // The base (tiered) item carries the whole amount; the add-ons carry none.
    expect(items[0].historical_billed_amount).toBe('450.00');
    expect(items[1].historical_billed_amount).toBeNull();
    expect(items[2].historical_billed_amount).toBeNull();

    // Σ over the sale == the row's own Billed amount, exactly — no invented cents (#1).
    const total = items.reduce((sum, i) => sum + Number(i.historical_billed_amount ?? 0), 0);
    expect(total).toBe(450);
  });

  /**
   * `create_missing` — the opt-in that lets a MIGRATION create the reference records its rows point at.
   * It must never reach the live-sales path, and it must never invent money.
   */
  describe('create_missing (historical sales only)', () => {
    const historicalRow = (over: Record<string, unknown> = {}) => ({
      id: 'r1',
      match_status: 'matched',
      mapped_data: { client_code: 'NEW', rep_code: 'RW-D-9999', product_types: 'internet', sale_date: '2025-03-12', billed_amount: '60.00', ...over },
    });

    it('creates the missing client, rep and product inside the commit transaction', async () => {
      const { service, prisma, tx } = make();
      tx.client.findUnique.mockResolvedValue(null);
      tx.client.create.mockResolvedValue({ id: 'c-new', client_code: 'NEW' });
      tx.rep.findFirst.mockResolvedValue(null); // neither rep_code nor external_code resolves
      tx.rep.create.mockResolvedValue({ id: 'rep-new' });
      tx.product.findFirst.mockResolvedValue(null);
      tx.product.create.mockResolvedValue({ id: 'p-new' });
      prisma.importBatch.findUnique.mockResolvedValue(
        stagedBatch({ source_type: 'master_migration', import_type: 'sales', client_id: null, create_missing: true, import_rows: [historicalRow()] }),
      );

      await service.commit('b1', user);

      expect(tx.client.create).toHaveBeenCalledTimes(1);
      expect(tx.rep.create).toHaveBeenCalledTimes(1);
      expect(tx.product.create).toHaveBeenCalledTimes(1);
      // Provisional, obviously-named, and carrying NO money.
      const client = (tx.client.create.mock.calls[0][0] as { data: { client_code: string; name: string } }).data;
      expect(client).toMatchObject({ client_code: 'NEW', name: 'NEW' });
      const product = (tx.product.create.mock.calls[0][0] as { data: { product_type: string } }).data;
      expect(product.product_type).toBe('internet');
      // A created product must NEVER get a billing rate — the two rate streams stay separate (#3).
      expect(tx.clientBillingRate.create).not.toHaveBeenCalled();
    });

    it('creates NOTHING when the batch was staged without the flag', async () => {
      const { service, prisma, tx } = make();
      tx.client.findUnique.mockResolvedValue(null);
      prisma.importBatch.findUnique.mockResolvedValue(
        stagedBatch({ source_type: 'master_migration', import_type: 'sales', client_id: null, create_missing: false, import_rows: [historicalRow()] }),
      );
      await expect(service.commit('b1', user)).rejects.toBeTruthy(); // the row's client does not exist
      expect(tx.client.create).not.toHaveBeenCalled();
      expect(tx.rep.create).not.toHaveBeenCalled();
    });

    it('is REFUSED for live sales — invented master data must never reach the engine', async () => {
      const { service } = make();
      const file = { buffer: Buffer.from('x'), originalname: 'x.csv', mimetype: 'text/csv', size: 1 };
      await expect(
        service.preview(file, { source_type: 'sales_entry', import_type: 'sales', create_missing: true } as never),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
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

// ── Back-dated REP-stream config migration (km rates · tier schedules · commission flat rates) ────────
// The live services reject a past `effective_from` (422) to protect closed periods (#10). These targets
// are the audited way to load history, mirroring the existing billing-rate handler. The guard itself is
// asserted still-intact in km-rate.service.spec.ts and tier-schedule.service.spec.ts.
// — docs/claude-code/04-backdate-import.md
describe('ImportService — back-dated config migration (#10)', () => {
  const PAST = '2020-03-15'; // comfortably before any "today" this suite could run at

  const stagedConfig = (importType: string, mapped: Record<string, unknown>) =>
    stagedBatch({
      source_type: 'master_migration',
      import_type: importType,
      client_id: null,
      matched_rows: 1,
      import_rows: [{ id: 'r1', match_status: 'matched', matched_entity_id: null, mapped_data: mapped }],
    });

  it('writes a BACK-DATED km rate — the date the live service would have refused', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedConfig('km_rates', { stream: 'rep', rate_per_km: '0.45', effective_from: PAST, client_code: null }),
    );
    await service.commit('b1', user);
    const data = (tx.kmRateConfig.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.stream).toBe('rep');
    expect(data.rate_per_km).toBe('0.45'); // exact decimal STRING, never a float (#1)
    expect((data.effective_from as Date).toISOString().slice(0, 10)).toBe(PAST);
    expect(data.client_id).toBeNull(); // blank client_code = the global default scope

    // ROUND TRIP — the packet's real requirement is not "a row was written" but "an expense that predates
    // today can now be priced". Feed exactly what the handler wrote to the SAME pure selector the km
    // submit path uses: a trip dated after the imported effective_from resolves to the imported rate.
    const written = { id: 'km-1', client_id: data.client_id as string | null, rate_per_km: data.rate_per_km as string, effective_from: data.effective_from as Date, effective_to: null };
    expect(selectKmRate([written], null, new Date('2020-06-01T00:00:00Z'))).toBe('0.45');
    // …and a date BEFORE it still resolves to nothing, so an import can't retroactively price everything.
    expect(selectKmRate([written], null, new Date('2019-12-31T00:00:00Z'))).toBeNull();
  });

  it('scopes a km rate to a client when the row names one, and keeps the two streams separate (#3)', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedConfig('km_rates', { stream: 'client_bill', rate_per_km: '0.50', effective_from: PAST, client_code: 'VF' }),
    );
    await service.commit('b1', user);
    const data = (tx.kmRateConfig.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.client_id).toBe('c1');
    expect(data.stream).toBe('client_bill');
    // The REP stream is untouched by a client_bill row — they are separate rows on separate scopes.
    expect(tx.kmRateConfig.create).toHaveBeenCalledTimes(1);
  });

  it('writes a BACK-DATED tier schedule as ONE row = config + every bracket', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedConfig('commission_tiers', { tiers: '0-6:110|7-16:125|17-35:145|36+:160', effective_from: PAST, client_code: null }),
    );
    await service.commit('b1', user);
    const data = (tx.commissionTierConfig.create.mock.calls[0][0] as {
      data: { client_id: string | null; effective_from: Date; tiers: { create: { tier_number: number; min_count: number; max_count: number | null; rate_per_activation: string }[] } };
    }).data;
    expect(data.client_id).toBeNull(); // the GLOBAL schedule
    expect(data.effective_from.toISOString().slice(0, 10)).toBe(PAST);
    // Created together, so a schedule is never half-written.
    expect(data.tiers.create).toHaveLength(4);
    expect(data.tiers.create.map((t) => t.rate_per_activation)).toEqual(['110', '125', '145', '160']);
    // Tier 1 is the top earner (Schedule C v2), assigned by rate — the operator never supplies numbers.
    expect(data.tiers.create.find((t) => t.rate_per_activation === '160')!.tier_number).toBe(1);
    expect(data.tiers.create.find((t) => t.max_count === null)!.min_count).toBe(36);

    // ROUND TRIP — the imported schedule must be the one IN FORCE for a historical sale_date, which is
    // what makes it reach the engine. Same pure selector the commission config provider uses.
    const written = { id: 'tier-cfg-1', client_id: data.client_id, effective_from: data.effective_from, effective_to: null };
    expect(selectEffectiveRate([written], new Date('2021-01-01T00:00:00Z'))).toBe(written);
    expect(selectEffectiveRate([written], new Date('2019-01-01T00:00:00Z'))).toBeNull();
  });

  it('writes a BACK-DATED commission flat rate against an existing catalogue type', async () => {
    const { service, prisma, tx } = make();
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedConfig('commission_flat_rates', { product_type: 'tv', amount: '30.00', effective_from: PAST, client_code: null }),
    );
    await service.commit('b1', user);
    const data = (tx.commissionFlatRate.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.product_type).toBe('tv');
    expect(data.amount).toBe('30.00'); // exact decimal STRING (#1)
    expect((data.effective_from as Date).toISOString().slice(0, 10)).toBe(PAST);
  });

  it('never invents a product type — an unknown key rolls the whole batch back (§14 rule 7)', async () => {
    const { service, prisma, tx } = make();
    tx.productTypeCatalogue.findUnique.mockResolvedValue(null);
    prisma.importBatch.findUnique.mockResolvedValue(
      stagedConfig('commission_flat_rates', { product_type: 'parking', amount: '30.00', effective_from: PAST, client_code: null }),
    );
    await expect(service.commit('b1', user)).rejects.toThrow(/not in the catalogue/i);
    expect(tx.commissionFlatRate.create).not.toHaveBeenCalled();
  });

  it('classifies a malformed tier cell as an ERROR at stage, so the gate blocks it before any write', async () => {
    const { service, prisma } = make([{ Tiers: '0-6:110|8+:125', 'Effective from': '2020-03-15' }], ['Tiers', 'Effective from']);
    await service.stage(file, { source_type: 'master_migration', import_type: 'commission_tiers' } as never, user);
    const data = (prisma.importBatch.create.mock.calls[0][0] as {
      data: { import_rows: { create: { match_status: string; issue: string | null }[] } };
    }).data;
    expect(data.import_rows.create[0].match_status).toBe('error'); // a gap between 6 and 8
    expect(data.import_rows.create[0].issue).toMatch(/contiguous|gap|bracket/i);
  });

  it('rejects create_missing on a config target — it is a historical-sales-only affordance', async () => {
    const { service } = make([{}], []);
    await expect(
      service.stage(file, { source_type: 'master_migration', import_type: 'km_rates', create_missing: true } as never, user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
