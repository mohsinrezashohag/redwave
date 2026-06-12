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
  const storage = { assertConfigured: jest.fn(), signedUrl: jest.fn().mockResolvedValue('https://signed/receipt') };
  // The unified-pipeline claim (FilesService mocked — the claim rules have their own spec).
  const files = { claim: jest.fn().mockResolvedValue({ path: 'receipts/2026/06/r.jpg', uploaded_by: 'u1' }) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const service = new ExpensesService(
    prisma as never,
    audit as never,
    scope as never,
    maps as never,
    storage as never,
    files as never,
    emitter as never,
  );
  return { service, prisma, audit, scope, maps, storage, files, tx, emitter };
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
  const pending = { id: 'i1', status: 'submitted', submitted_by: 'u1', expense_date: new Date('2026-03-10T00:00:00.000Z'), pay_period_id: 'P1' };

  it('approve → status approved + approved_by/at set', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findFirst.mockResolvedValue(pending);
    await service.review('i1', { decision: ReviewDecision.approve }, superAdmin);
    const data = (prisma.expenseItem.update.mock.calls[0][0] as {
      data: { status: string; approved_by: string | null; approved_at: Date | null };
    }).data;
    expect(data.status).toBe('approved');
    expect(data.approved_by).toBe('sa');
    expect(data.approved_at).toBeInstanceOf(Date);
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
      { id: 'i1', status: 'submitted', submitted_by: 'u1', expense_date: new Date('2026-03-10T00:00:00.000Z'), pay_period_id: 'P1' },
      { id: 'i2', status: 'approved', submitted_by: 'u1', expense_date: new Date('2026-03-10T00:00:00.000Z'), pay_period_id: 'P1' },
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
