import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { ExpensesService } from './expenses.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ExpenseItemInput } from './dto/expense-item.input';
import { CreateExpenseItemsDto } from './dto/create-items.dto';
import { ReviewDecision } from './dto/review.dto';

const user: AuthUser = {
  id: 'u1',
  email: 'u@x.co',
  full_name: 'User',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(),
  repId: 'rep-1',
};
const superAdmin: AuthUser = { ...user, id: 'sa', isSuperAdmin: true };

const CONFIGS = [
  { category_key: 'km', requires_receipt: false, is_active: true },
  { category_key: 'meals', requires_receipt: true, is_active: true },
  { category_key: 'gas', requires_receipt: true, is_active: true },
  { category_key: 'other', requires_receipt: false, is_active: false }, // disabled
];

function make() {
  const tx = {
    expenseItem: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'i1', km_log: null, ...data }),
        ),
      update: jest.fn().mockResolvedValue({ id: 'i1', category: 'meals', amount: { toString: () => '42.50' } }),
      delete: jest.fn(),
    },
    expenseKmLog: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() },
    expenseKmStop: { deleteMany: jest.fn() },
  };
  const prisma = {
    payPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'P1' }) },
    expenseFieldConfig: { findMany: jest.fn().mockResolvedValue(CONFIGS) },
    rep: { findUnique: jest.fn().mockResolvedValue(null) },
    expenseItem: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest
        .fn()
        .mockResolvedValue({ id: 'i1', status: 'approved', submitted_by: 'u1', expense_date: new Date('2026-03-10T00:00:00.000Z'), pay_period_id: 'P1' }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = { getRepScope: jest.fn().mockResolvedValue({ level: 'all' }) };
  // Maps OFF by default → km distance falls back to the client total_km (preserves the 130→70→31.50 case).
  const maps = { routeDistanceKm: jest.fn().mockResolvedValue(null), isConfigured: jest.fn().mockReturnValue(false) };
  // KM rate resolves to the default $0.45 by default (preserves the 130→70→31.50 case).
  const kmRates = { resolveRepRate: jest.fn().mockResolvedValue(new Decimal('0.450')) };
  // FX source OFF by default (manual) → foreign approvals need an override (CAD items never call it).
  const fx = { getRateToCad: jest.fn().mockResolvedValue(null), isAutoEnabled: jest.fn().mockReturnValue(false) };
  const storage = { assertConfigured: jest.fn(), signedUrl: jest.fn().mockResolvedValue('https://signed/receipt') };
  // The unified-pipeline claim (FilesService mocked — the claim rules have their own spec).
  const files = { claim: jest.fn().mockResolvedValue({ path: 'receipts/2026/06/r.jpg', uploaded_by: 'u1' }) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const service = new ExpensesService(
    prisma as never,
    audit as never,
    scope as never,
    maps as never,
    kmRates as never,
    fx as never,
    storage as never,
    files as never,
    emitter as never,
  );
  return { service, prisma, audit, scope, maps, kmRates, fx, storage, files, tx, emitter };
}

const kmItem = (date = '2026-03-10', tripType: 'single' | 'round' = 'round'): ExpenseItemInput => ({
  category: 'km',
  expense_date: date,
  description: 'Client visit',
  km: {
    trip_type: tripType,
    total_km: '130.00',
    stops: [
      { stop_order: 0, address: 'A', lat: '49.0', lng: '-97.0' },
      { stop_order: 1, address: 'B', lat: '49.5', lng: '-97.5' },
    ],
  },
});
const mealItem = (receipt = true): ExpenseItemInput => ({
  category: 'meals',
  expense_date: '2026-03-11',
  amount: '42.50',
  description: 'Lunch',
  ...(receipt ? { receipt_url: 'receipts/2026/06/r.jpg' } : {}),
});

const dto = (items: ExpenseItemInput[]): CreateExpenseItemsDto => ({ items });

const createdItems = (tx: ReturnType<typeof make>['tx']) =>
  tx.expenseItem.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

describe('ExpensesService.createItems (SRS §11, item-first)', () => {
  it('km item: amount is COMPUTED (130 round → 70 → $31.50), no receipt required', async () => {
    const { service, tx } = make();
    await service.createItems(dto([kmItem()]), user);
    const item = createdItems(tx)[0] as {
      amount: string;
      receipt_url: string | null;
      km_log: { create: { billable_km: string; computed_amount: string; rate_per_km: string } };
    };
    expect(item.amount).toBe('31.50');
    expect(item.receipt_url).toBeNull();
    expect(item.km_log.create.billable_km).toBe('70');
    expect(item.km_log.create.computed_amount).toBe('31.50');
    expect(item.km_log.create.rate_per_km).toBe('0.45');
  });

  it('non-km item: receipt is MANDATORY (meals without a receipt → 422)', async () => {
    const { service } = make();
    await expect(service.createItems(dto([mealItem(false)]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('non-km item with a receipt is accepted; amount stored as the exact decimal string', async () => {
    const { service, tx } = make();
    await service.createItems(dto([mealItem(true)]), user);
    expect((createdItems(tx)[0] as { amount: string }).amount).toBe('42.50');
  });

  it('rejects a second km log on the same day within the batch (one per day) → 422', async () => {
    const { service } = make();
    await expect(
      service.createItems(dto([kmItem('2026-03-10'), kmItem('2026-03-10')]), user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a km log clashing with an EXISTING item for that rep/day → 422', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue({ expense_date: new Date('2026-03-10T00:00:00.000Z') });
    await expect(service.createItems(dto([kmItem('2026-03-10')]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects an amount missing on a non-km item → 422', async () => {
    const { service } = make();
    const bad = { category: 'gas', expense_date: '2026-03-11', description: 'Fuel' } as ExpenseItemInput;
    await expect(service.createItems(dto([bad]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a km log attached to a non-km item → 422', async () => {
    const { service } = make();
    const bad = { ...mealItem(true), km: kmItem().km } as ExpenseItemInput;
    await expect(service.createItems(dto([bad]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects an inactive/unknown category → 422', async () => {
    const { service } = make();
    const bad = { category: 'other', expense_date: '2026-03-11', amount: '10.00', description: 'x' } as ExpenseItemInput;
    await expect(service.createItems(dto([bad]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  // BE-4: when Maps is configured the server re-derives the route distance and IGNORES the client total_km.
  it('km amount uses the server-derived distance when Maps is available (100 round → 40 → $18.00)', async () => {
    const { service, tx, maps } = make();
    maps.routeDistanceKm.mockResolvedValue(new Decimal('100')); // server says 100 km, client claimed 130
    await service.createItems(dto([kmItem()]), user);
    const item = createdItems(tx)[0] as { amount: string; km_log: { create: { total_km: string; billable_km: string } } };
    expect(item.km_log.create.total_km).toBe('100.00'); // authoritative server distance, not 130
    expect(item.km_log.create.billable_km).toBe('40'); // 100 − 60 (round)
    expect(item.amount).toBe('18.00'); // 40 × $0.45
  });

  it('defaults rep_id to the submitter’s rep; status starts submitted', async () => {
    const { service, tx } = make();
    await service.createItems(dto([kmItem()]), user);
    const data = createdItems(tx)[0] as { rep_id: string; status: string };
    expect(data.rep_id).toBe('rep-1');
    expect(data.status).toBe('submitted');
  });

  // BE-3: the pay period is derived from the item's OWN expense_date (same-cycle payout, EXP-009).
  it('derives pay_period_id from the item’s expense_date, not a report week', async () => {
    const { service, prisma, tx } = make();
    prisma.payPeriod.findFirst.mockResolvedValue({ id: 'P-MARCH' });
    await service.createItems(dto([mealItem(true)]), user);
    const where = (prisma.payPeriod.findFirst.mock.calls[0][0] as { where: { start_date: object; end_date: object } }).where;
    // queried with the item's date on both bounds (start_date ≤ date ≤ end_date)
    expect(where.start_date).toEqual({ lte: new Date('2026-03-11T00:00:00.000Z') });
    expect(where.end_date).toEqual({ gte: new Date('2026-03-11T00:00:00.000Z') });
    expect((createdItems(tx)[0] as { pay_period_id: string }).pay_period_id).toBe('P-MARCH');
  });
});

describe('ExpensesService.review (per-item approval workflow)', () => {
  // A CAD item — amount_cad was frozen at create, so approving it triggers NO FX freeze.
  const pending = {
    id: 'i1',
    status: 'submitted',
    submitted_by: 'u1',
    expense_date: new Date('2026-03-10T00:00:00.000Z'),
    pay_period_id: 'P1',
    amount: new Decimal('42.50'),
    original_currency: 'CAD',
    amount_cad: new Decimal('42.50'),
  };
  // A foreign (USD) item — amount_cad null until it freezes at approval.
  const foreign = { ...pending, id: 'iu', amount: new Decimal('10.00'), original_currency: 'USD', amount_cad: null };

  it('approve → status approved + approved_by/at set; a CAD item freezes NO FX', async () => {
    const { service, prisma, fx } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(pending);
    await service.review('i1', { decision: ReviewDecision.approve }, superAdmin);
    const data = (prisma.expenseItem.update.mock.calls[0][0] as {
      data: { status: string; approved_by: string | null; approved_at: Date | null; fx_rate?: string };
    }).data;
    expect(data.status).toBe('approved');
    expect(data.approved_by).toBe('sa');
    expect(data.approved_at).toBeInstanceOf(Date);
    expect(data.fx_rate).toBeUndefined(); // CAD → no re-conversion at approval
    expect(fx.getRateToCad).not.toHaveBeenCalled();
  });

  it('approving a FOREIGN item with an override → freezes fx_rate, fx_rate_date, amount_cad (#12)', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(foreign);
    await service.review('iu', { decision: ReviewDecision.approve, fx_rate: '1.36500000' }, superAdmin);
    const data = (prisma.expenseItem.update.mock.calls[0][0] as {
      data: { fx_rate: string; fx_rate_date: Date; amount_cad: string };
    }).data;
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.fx_rate_date).toBeInstanceOf(Date);
    expect(data.amount_cad).toBe('13.65'); // 10.00 × 1.365
  });

  it('approving a FOREIGN item uses the FX source when no override is given', async () => {
    const { service, prisma, fx } = make();
    fx.getRateToCad.mockResolvedValue(new Decimal('1.40000000'));
    prisma.expenseItem.findFirst.mockResolvedValue(foreign);
    await service.review('iu', { decision: ReviewDecision.approve }, superAdmin);
    expect(fx.getRateToCad).toHaveBeenCalledWith('USD', expect.any(Date));
    const data = (prisma.expenseItem.update.mock.calls[0][0] as { data: { amount_cad: string } }).data;
    expect(data.amount_cad).toBe('14.00'); // 10.00 × 1.40
  });

  // Rounding-boundary on APPROVAL: 10.00 USD × 1.3625 = 13.625 → 13.63 HALF-UP (not 13.62 half-even).
  it('freezes amount_cad HALF-UP at a .xx5 boundary (10.00 × 1.3625 = 13.625 → 13.63)', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(foreign);
    await service.review('iu', { decision: ReviewDecision.approve, fx_rate: '1.3625' }, superAdmin);
    expect((prisma.expenseItem.update.mock.calls[0][0] as { data: { amount_cad: string } }).data.amount_cad).toBe('13.63');
  });

  it('approving a FOREIGN item with NO override + FX source OFF → 422 (never guess)', async () => {
    const { service, prisma } = make(); // fx.getRateToCad returns null by default
    prisma.expenseItem.findFirst.mockResolvedValue(foreign);
    await expect(
      service.review('iu', { decision: ReviewDecision.approve }, superAdmin),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.expenseItem.update).not.toHaveBeenCalled();
  });

  it('a re-approval never re-converts (already-approved item is not reviewable → 422)', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue({ ...foreign, status: 'approved', amount_cad: new Decimal('14.00') });
    await expect(
      service.review('iu', { decision: ReviewDecision.approve, fx_rate: '99' }, superAdmin),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.expenseItem.update).not.toHaveBeenCalled();
  });

  it('reject → status rejected, approved_by null', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(pending);
    await service.review('i1', { decision: ReviewDecision.reject }, superAdmin);
    const data = (prisma.expenseItem.update.mock.calls[0][0] as { data: { status: string; approved_by: null } }).data;
    expect(data.status).toBe('rejected');
    expect(data.approved_by).toBeNull();
  });

  it('send_back → status sent_back', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(pending);
    await service.review('i1', { decision: ReviewDecision.send_back }, superAdmin);
    expect((prisma.expenseItem.update.mock.calls[0][0] as { data: { status: string } }).data.status).toBe(
      'sent_back',
    );
  });

  it('rejects reviewing an already-approved item → 422', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue({ ...pending, status: 'approved' });
    await expect(
      service.review('i1', { decision: ReviewDecision.approve }, superAdmin),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ExpensesService.bulkReview', () => {
  it('transitions reviewable items and skips the rest', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findMany.mockResolvedValue([
      { id: 'i1', status: 'submitted', submitted_by: 'u1', expense_date: new Date('2026-03-10T00:00:00.000Z'), pay_period_id: 'P1', amount: new Decimal('42.50'), original_currency: 'CAD', amount_cad: new Decimal('42.50') },
      { id: 'i2', status: 'approved', submitted_by: 'u1', expense_date: new Date('2026-03-10T00:00:00.000Z'), pay_period_id: 'P1', amount: new Decimal('10.00'), original_currency: 'CAD', amount_cad: new Decimal('10.00') },
    ]);
    const result = await service.bulkReview(
      { ids: ['i1', 'i2'], decision: ReviewDecision.approve },
      superAdmin,
    );
    expect(result).toEqual({ reviewed: 1, skipped: 1 });
  });
});

describe('ExpensesService.editItem (edit-rights gating — EXP-007)', () => {
  const submitted = { id: 'i1', status: 'submitted', rep_id: 'rep-1', category: 'meals', amount: { toString: () => '42.50' }, expense_date: new Date('2026-03-11T00:00:00.000Z') };
  const approved = { ...submitted, status: 'approved' };

  it('pre-approval edit (status submitted) is allowed with expenses:edit', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(submitted);
    await expect(service.editItem('i1', mealItem(true), user)).resolves.toBeDefined();
  });

  it('after approval, a non-Super-Admin edit is FORBIDDEN → 403', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(approved);
    await expect(service.editItem('i1', mealItem(true), user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('after approval, a Super Admin edit is allowed', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(approved);
    await expect(service.editItem('i1', mealItem(true), superAdmin)).resolves.toBeDefined();
  });
});

describe('ExpensesService — receipt claim + access-controlled receipt URL (security.md file storage)', () => {
  it('a stored-path receipt is CLAIMED at create (must be the caller’s own upload)', async () => {
    const { service, files } = make();
    await service.createItems(dto([mealItem()]), user);
    expect(files.claim).toHaveBeenCalledWith('receipts/2026/06/r.jpg', user, 'receipt');
  });

  it('a rejected claim (unknown/foreign path) blocks the create with 422', async () => {
    const { service, files, tx } = make();
    files.claim.mockRejectedValue(new UnprocessableEntityException('unknown receipt file reference'));
    await expect(service.createItems(dto([mealItem()]), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.expenseItem.create).not.toHaveBeenCalled();
  });

  it('LEGACY values (http(s) URL from the pre-stored_files pipeline) skip the claim — old items stay editable', async () => {
    const { service, files } = make();
    await service.createItems(dto([{ ...mealItem(false), receipt_url: 'https://old.signed/url.jpg' }]), user);
    expect(files.claim).not.toHaveBeenCalled();
  });

  it('receiptUrl signs the stored path for 60s + audits the issuance; no receipt → 404', async () => {
    const { service, prisma, storage, audit } = make();
    prisma.expenseItem.findFirst.mockResolvedValue({ id: 'i1', receipt_url: 'receipts/2026/06/r.jpg' });
    const res = await service.receiptUrl('i1', user);
    expect(storage.signedUrl).toHaveBeenCalledWith('receipts/2026/06/r.jpg', 60);
    expect(res).toEqual({ url: 'https://signed/receipt' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'download', entityId: 'i1' }));

    prisma.expenseItem.findFirst.mockResolvedValue({ id: 'i2', receipt_url: null });
    await expect(service.receiptUrl('i2', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a LEGACY stored URL passes through as-is (served as recorded)', async () => {
    const { service, prisma, storage } = make();
    prisma.expenseItem.findFirst.mockResolvedValue({ id: 'i1', receipt_url: 'https://old.signed/url.jpg' });
    const res = await service.receiptUrl('i1', user);
    expect(res.url).toBe('https://old.signed/url.jpg');
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.list (scoping — §5)', () => {
  it('self scope builds an OR(submitted_by, rep_id) where — never filtered after fetch', async () => {
    const { service, prisma, scope } = make();
    scope.getRepScope.mockResolvedValue({ level: 'self', repIds: ['rep-1'] });
    await service.list({}, user);
    const where = (prisma.expenseItem.findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[0]).toEqual({ OR: [{ submitted_by: 'u1' }, { rep_id: { in: ['rep-1'] } }] });
  });

  it('all scope (admin) applies no rep restriction and returns a {data, meta} page', async () => {
    const { service, prisma, scope } = make();
    scope.getRepScope.mockResolvedValue({ level: 'all' });
    const page = await service.list({}, superAdmin);
    const where = (prisma.expenseItem.findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[0]).toEqual({});
    expect(page.meta).toEqual({ total: 0, page: 1, limit: 20, pageCount: 0 });
  });
});

// ── Per-type fields + Alert/Warning validation (EXP-002a / EXP-013) ────────────────────────────
const RICH_MEALS = {
  category_key: 'meals',
  requires_receipt: true,
  is_active: true,
  amount_soft_cap: { toString: () => '30.00' },
  fields: [
    { key: 'vendor', label: 'Vendor', type: 'text', required: true },
    { key: 'gratuity', label: 'Gratuity', type: 'money', required: false, soft_cap: '20.00' },
  ],
};
const dec = (s: string) => ({ toString: () => s });

describe('ExpensesService — per-type fields + Alert/Warning (EXP-013)', () => {
  it('ALERT blocks save: a meals item missing the required vendor field → 422', async () => {
    const { service, prisma } = make();
    prisma.expenseFieldConfig.findMany.mockResolvedValue([RICH_MEALS]);
    await expect(service.createItems(dto([mealItem(true)]), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('persists field_values FILTERED to the schema keys (unknown keys dropped)', async () => {
    const { service, tx, prisma } = make();
    prisma.expenseFieldConfig.findMany.mockResolvedValue([RICH_MEALS]);
    const item = { ...mealItem(true), field_values: { vendor: 'Tim Hortons', gratuity: '5.00', junk: 'x' } } as ExpenseItemInput;
    await service.createItems(dto([item]), user);
    expect((createdItems(tx)[0] as { field_values: Record<string, string> }).field_values).toEqual({ vendor: 'Tim Hortons', gratuity: '5.00' });
  });

  it('WARNING does not block: an over-soft-cap meal saves, and gratuity NEVER changes the amount (#1)', async () => {
    const { service, tx, prisma } = make();
    prisma.expenseFieldConfig.findMany.mockResolvedValue([RICH_MEALS]);
    const item = { ...mealItem(true), amount: '45.00', field_values: { vendor: 'X', gratuity: '10.00' } } as ExpenseItemInput;
    await service.createItems(dto([item]), user);
    const created = createdItems(tx)[0] as { amount: string; amount_cad: string };
    expect(created.amount).toBe('45.00'); // gratuity not added
    expect(created.amount_cad).toBe('45.00'); // reimbursable CAD unchanged by the per-type field
  });

  it('attaches derived validation on read (findOne) — vendor missing → an alert', async () => {
    const { service, prisma } = make();
    prisma.expenseFieldConfig.findMany.mockResolvedValue([RICH_MEALS]);
    prisma.expenseItem.findFirst.mockResolvedValue({ id: 'i1', category: 'meals', amount: dec('45.00'), receipt_url: 'r', field_values: {}, km_log: null, status: 'submitted' });
    const item = (await service.findOne('i1', superAdmin)) as unknown as { validation: { alert_count: number; warning_count: number } };
    expect(item.validation.alert_count).toBe(1); // vendor missing
    expect(item.validation.warning_count).toBe(1); // 45 > 30 soft cap
  });

  it('validationSummary aggregates alerts + warnings across the scoped set', async () => {
    const { service, prisma } = make();
    prisma.expenseFieldConfig.findMany.mockResolvedValue([RICH_MEALS]);
    prisma.expenseItem.findMany.mockResolvedValue([
      { category: 'meals', amount: dec('20.00'), receipt_url: 'r', field_values: {}, km_log: null }, // alert (no vendor)
      { category: 'meals', amount: dec('45.00'), receipt_url: 'r', field_values: { vendor: 'X' }, km_log: null }, // warning (over cap)
      { category: 'meals', amount: dec('20.00'), receipt_url: 'r', field_values: { vendor: 'X' }, km_log: null }, // clean
    ]);
    const summary = await service.validationSummary({}, superAdmin);
    expect(summary).toMatchObject({ total: 3, alert_items: 1, warning_items: 1, flagged: 2, alert_count: 1, warning_count: 1 });
  });
});
