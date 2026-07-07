import { readFileSync } from 'fs';
import { join } from 'path';
import { UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { ClientExpenseDocService } from './expense-doc.service';
import { StatementService } from './statement.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dec = (s: string) => ({ toString: () => s }); // Prisma.Decimal-ish

type ItemOver = Partial<{
  id: string;
  category: 'km' | 'meals';
  expense_date: Date;
  amount: { toString: () => string };
  original_currency: string;
  description: string | null;
  rep_id: string | null;
  rep: { full_name: string } | null;
  km_log: { billable_km: { toString: () => string } } | null;
}>;

const meal = (over: ItemOver = {}) => ({
  id: 'm1',
  category: 'meals' as const,
  expense_date: d('2026-01-10'),
  amount: dec('20.00'),
  original_currency: 'CAD',
  description: 'Lunch',
  rep_id: 'rep1',
  rep: { full_name: 'Alice' },
  km_log: null,
  ...over,
});

const km = (over: ItemOver = {}) =>
  meal({
    id: 'k1',
    category: 'km',
    description: null,
    amount: dec('45.00'), // REP-priced stored amount — must NOT be used
    km_log: { billable_km: dec('100.00') },
    ...over,
  });

const kmRate = (clientId: string | null, from: string, to: string | null, rate: string) => ({
  id: `k-${from}`,
  client_id: clientId,
  rate_per_km: dec(rate),
  effective_from: d(from),
  effective_to: to ? d(to) : null,
});

const seqStub = () => {
  let n = 0;
  return { next: jest.fn(async () => (n += 1)) };
};

function make(opts: {
  items: ReturnType<typeof meal>[];
  kmRates?: ReturnType<typeof kmRate>[];
  currency?: string;
  priorDocId?: string | null;
  fxRate?: string | null;
}) {
  const tx = {
    clientExpenseDocument: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'doc-new', ...data })),
      findFirst: jest.fn().mockResolvedValue(opts.priorDocId ? { id: opts.priorDocId } : null),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data })),
    },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', client_code: 'CTI', currency: opts.currency ?? 'CAD' }) },
    payPeriod: { findUnique: jest.fn().mockResolvedValue({ id: 'P1', period_number: 3 }) },
    expenseItem: { findMany: jest.fn().mockResolvedValue(opts.items) },
    kmRateConfig: { findMany: jest.fn().mockResolvedValue(opts.kmRates ?? []) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // FX source returns the rate (foreign) or null (CAD short-circuits before calling it).
  const fx = {
    getRateToCad: jest.fn().mockResolvedValue(opts.fxRate != null ? new Decimal(opts.fxRate) : null),
    isAutoEnabled: jest.fn().mockReturnValue(opts.fxRate != null),
  };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  // Real StatementService — used ONLY for resolveIssueFx (shares the fx stub).
  const statements = new StatementService(prisma as never, audit as never, seqStub() as never, fx as never, emitter as never);
  const service = new ClientExpenseDocService(prisma as never, audit as never, seqStub() as never, statements);
  return { service, prisma, tx, audit };
}

const createdData = (tx: ReturnType<typeof make>['tx']) =>
  (tx.clientExpenseDocument.create.mock.calls[0][0] as {
    data: { document_number: number; status: string; currency: string; fx_rate: string; amount_cad: string; total_amount: string; line_detail: { type: string; amount: string; description: string }[]; superseded_by_id?: string };
  }).data;

describe('ClientExpenseDocService — pricing (BILL-012 / EXP-014)', () => {
  it('re-prices km at the CLIENT-BILL rate — never the stored rep amount', async () => {
    const { service, tx } = make({ items: [km()], kmRates: [kmRate(null, '2026-01-01', null, '0.600')] });
    await service.generate('c1', 'P1', 'actor');
    const data = createdData(tx);
    expect(data.line_detail[0].amount).toBe('60.00'); // 100 billable × 0.60 client-bill
    expect(data.line_detail[0].amount).not.toBe('45.00'); // NOT the stored rep-priced amount
    expect(data.total_amount).toBe('60.00');
  });

  it('queries ONLY approved, non-personal km+meals items for the client/period', async () => {
    const { service, prisma } = make({ items: [], kmRates: [] });
    await service.preview('c1', 'P1');
    const where = prisma.expenseItem.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ client_id: 'c1', pay_period_id: 'P1', status: 'approved', is_personal: false, category: { in: ['km', 'meals'] } });
  });

  it('422s when a km item has no client-bill rate for its date (never falls back to $0.45)', async () => {
    const { service } = make({ items: [km()], kmRates: [] });
    await expect(service.preview('c1', 'P1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.generate('c1', 'P1', 'actor')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('excludes food whose entry currency ≠ the client currency (native rule, no conversion)', async () => {
    const { service } = make({ items: [meal({ original_currency: 'USD' })], currency: 'CAD' });
    const preview = await service.preview('c1', 'P1');
    expect(preview.lines).toHaveLength(0);
    expect(preview.total_amount).toBe('0.00');
    expect(preview.excluded).toEqual([{ item_id: 'm1', category: 'meals', reason: 'currency_mismatch' }]);
  });

  it('narrows scope by selected reps (query) and days (in-memory)', async () => {
    const { service, prisma } = make({
      items: [meal({ id: 'm1', expense_date: d('2026-01-10') }), meal({ id: 'm2', expense_date: d('2026-01-11'), amount: dec('9.00') })],
    });
    const preview = await service.preview('c1', 'P1', { rep_ids: ['rep1'], dates: ['2026-01-10'] });
    expect(prisma.expenseItem.findMany.mock.calls[0][0].where).toMatchObject({ rep_id: { in: ['rep1'] } });
    expect(preview.lines).toHaveLength(1); // only the 2026-01-10 item survives the day filter
    expect(preview.total_amount).toBe('20.00');
  });

  it('groups km + meals per rep per day and preview mints NOTHING', async () => {
    const { service, tx } = make({ items: [km(), meal()], kmRates: [kmRate(null, '2026-01-01', null, '0.500')] });
    const preview = await service.preview('c1', 'P1');
    expect(preview.lines.map((l) => l.type)).toEqual(['km', 'meals']); // km sorts first
    expect(preview.total_amount).toBe('70.00'); // 100×0.5 + 20
    expect(tx.clientExpenseDocument.create).not.toHaveBeenCalled(); // preview persists nothing
  });

  it('is immutable — generate mints a gapless number and supersedes the prior issued doc', async () => {
    const { service, tx } = make({ items: [meal()], priorDocId: 'doc-prior' });
    await service.generate('c1', 'P1', 'actor');
    expect(createdData(tx).document_number).toBe(1);
    expect(createdData(tx).status).toBe('issued');
    expect(tx.clientExpenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-prior' }, data: { status: 'superseded', superseded_by_id: 'doc-new' } }),
    );
  });

  it('freezes a frozen line_detail snapshot (money as strings) at issue', async () => {
    const { service, tx } = make({ items: [km(), meal()], kmRates: [kmRate(null, '2026-01-01', null, '0.500')] });
    await service.generate('c1', 'P1', 'actor');
    const detail = createdData(tx).line_detail;
    expect(detail).toEqual([
      { type: 'km', rep_id: 'rep1', rep_name: 'Alice', date: '2026-01-10', description: '100.00 km', amount: '50.00' },
      { type: 'meals', rep_id: 'rep1', rep_name: 'Alice', date: '2026-01-10', description: 'Lunch', amount: '20.00' },
    ]);
  });
});

describe('ClientExpenseDocService — USD client + FX freeze (#12)', () => {
  it('a USD doc with km(client-bill) + native USD food freezes amount_cad at issue', async () => {
    const { service, tx } = make({
      items: [km(), meal({ id: 'm1', original_currency: 'USD', amount: dec('40.00'), description: 'Dinner' })],
      kmRates: [kmRate(null, '2026-01-01', null, '0.600')],
      currency: 'USD',
      fxRate: '1.365',
    });
    await service.generate('c1', 'P1', 'actor');
    const data = createdData(tx);
    expect(data.currency).toBe('USD');
    expect(data.total_amount).toBe('100.00'); // 60 (100×0.60) + 40 USD
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.amount_cad).toBe('136.50'); // 100 × 1.365
  });

  it('rounds amount_cad HALF-UP at the .xx5 boundary', async () => {
    const { service, tx } = make({
      items: [km(), meal({ id: 'm1', original_currency: 'USD', amount: dec('63.45'), description: 'Dinner' })],
      kmRates: [kmRate(null, '2026-01-01', null, '0.600')],
      currency: 'USD',
      fxRate: '1.365',
    });
    await service.generate('c1', 'P1', 'actor');
    const data = createdData(tx);
    expect(data.total_amount).toBe('123.45'); // 60 + 63.45 USD
    expect(data.amount_cad).toBe('168.51'); // 123.45 × 1.365 = 168.51425 → half-up
  });
});

describe('ClientExpenseDocService — two streams never mix (#3)', () => {
  it('reads no commission/pay-run/clawback/holdback table (structural)', () => {
    const src = readFileSync(join(__dirname, 'expense-doc.service.ts'), 'utf8');
    expect(src).not.toMatch(/this\.prisma\.(commission|payRun|payRunLine|clawback|holdback|saleItem|tierSchedule)/i);
  });
});
