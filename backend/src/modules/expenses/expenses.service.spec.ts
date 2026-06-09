import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CreateReportDto } from './dto/create-report.dto';
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
    expenseItem: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), create: jest.fn() },
    expenseKmLog: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    expenseKmStop: { deleteMany: jest.fn() },
    expenseReport: { update: jest.fn().mockResolvedValue({ id: 'r1', expense_items: [] }) },
  };
  const prisma = {
    payPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'P1' }) },
    expenseFieldConfig: { findMany: jest.fn().mockResolvedValue(CONFIGS) },
    rep: { findUnique: jest.fn().mockResolvedValue(null) },
    expenseReport: {
      create: jest.fn().mockResolvedValue({ id: 'r1', pay_period_id: 'P1', expense_items: [{}] }),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({
        id: 'r1',
        expense_items: [],
        week_start: new Date('2026-01-04T00:00:00.000Z'),
        submitted_by: 'u1',
      }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = { getRepScope: jest.fn().mockResolvedValue({ level: 'all' }) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() };
  const service = new ExpensesService(prisma as never, audit as never, scope as never, emitter as never);
  return { service, prisma, audit, scope, tx, emitter };
}

const kmItem = (date = '2026-03-10', tripType: 'single' | 'round' = 'round') => ({
  category: 'km' as const,
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
const mealItem = (receipt = true) => ({
  category: 'meals' as const,
  expense_date: '2026-03-11',
  amount: '42.50',
  description: 'Lunch',
  ...(receipt ? { receipt_url: 's3://r/1.png' } : {}),
});

const report = (items: CreateReportDto['items']): CreateReportDto => ({
  week_start: '2026-03-09',
  week_end: '2026-03-15',
  items,
});

const createdItem = (prisma: ReturnType<typeof make>['prisma']) =>
  (prisma.expenseReport.create.mock.calls[0][0] as { data: { expense_items: { create: unknown[] } } })
    .data.expense_items.create;

describe('ExpensesService.submit (SRS §11)', () => {
  it('km item: amount is COMPUTED (130 round → 70 → $31.50), no receipt required', async () => {
    const { service, prisma } = make();
    await service.submit(report([kmItem()]), user);
    const item = createdItem(prisma)[0] as {
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
    await expect(service.submit(report([mealItem(false)]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('non-km item with a receipt is accepted; amount stored as the exact decimal string', async () => {
    const { service, prisma } = make();
    await service.submit(report([mealItem(true)]), user);
    expect((createdItem(prisma)[0] as { amount: string }).amount).toBe('42.50');
  });

  it('rejects a second km log on the same day (one per day) → 422', async () => {
    const { service } = make();
    await expect(
      service.submit(report([kmItem('2026-03-10'), kmItem('2026-03-10')]), user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an amount missing on a non-km item → 422', async () => {
    const { service } = make();
    const bad = { category: 'gas' as const, expense_date: '2026-03-11', description: 'Fuel' };
    await expect(service.submit(report([bad]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a km log attached to a non-km item → 422', async () => {
    const { service } = make();
    const bad = { ...mealItem(true), km: kmItem().km };
    await expect(service.submit(report([bad]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects an inactive/unknown category → 422', async () => {
    const { service } = make();
    const bad = {
      category: 'other' as const,
      expense_date: '2026-03-11',
      amount: '10.00',
      description: 'x',
    };
    await expect(service.submit(report([bad]), user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('defaults rep_id to the submitter’s rep and derives the pay period from week_start', async () => {
    const { service, prisma } = make();
    await service.submit(report([kmItem()]), user);
    const data = (prisma.expenseReport.create.mock.calls[0][0] as {
      data: { rep_id: string; pay_period_id: string; status: string };
    }).data;
    expect(data.rep_id).toBe('rep-1');
    expect(data.pay_period_id).toBe('P1');
    expect(data.status).toBe('submitted');
    expect(prisma.payPeriod.findFirst).toHaveBeenCalled();
  });
});

describe('ExpensesService.review (approval workflow)', () => {
  it('approve → status approved + approved_by/at set', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'submitted', expense_items: [] });
    await service.review('r1', { decision: ReviewDecision.approve }, superAdmin);
    const data = (prisma.expenseReport.update.mock.calls[0][0] as {
      data: { status: string; approved_by: string | null; approved_at: Date | null };
    }).data;
    expect(data.status).toBe('approved');
    expect(data.approved_by).toBe('sa');
    expect(data.approved_at).toBeInstanceOf(Date);
  });

  it('reject → status rejected, approved_by null', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'submitted', expense_items: [] });
    await service.review('r1', { decision: ReviewDecision.reject }, superAdmin);
    const data = (prisma.expenseReport.update.mock.calls[0][0] as { data: { status: string; approved_by: null } }).data;
    expect(data.status).toBe('rejected');
    expect(data.approved_by).toBeNull();
  });

  it('send_back → status sent_back', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'submitted', expense_items: [] });
    await service.review('r1', { decision: ReviewDecision.send_back }, superAdmin);
    expect((prisma.expenseReport.update.mock.calls[0][0] as { data: { status: string } }).data.status).toBe(
      'sent_back',
    );
  });

  it('rejects reviewing an already-approved report → 422', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'approved', expense_items: [] });
    await expect(
      service.review('r1', { decision: ReviewDecision.approve }, superAdmin),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ExpensesService.edit (edit-rights gating — EXP-007)', () => {
  it('pre-approval edit (status submitted) is allowed with expenses:edit', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'submitted', expense_items: [] });
    await expect(service.edit('r1', { week_end: '2026-03-16' }, user)).resolves.toBeDefined();
  });

  it('after approval, a non-Super-Admin edit is FORBIDDEN → 403', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'approved', expense_items: [] });
    await expect(service.edit('r1', { week_end: '2026-03-16' }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('after approval, a Super Admin edit is allowed', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue({ id: 'r1', status: 'approved', expense_items: [] });
    await expect(service.edit('r1', { week_end: '2026-03-16' }, superAdmin)).resolves.toBeDefined();
  });
});

describe('ExpensesService.list (scoping — §5)', () => {
  it('self scope builds an OR(submitted_by, rep_id) where — never filtered after fetch', async () => {
    const { service, prisma, scope } = make();
    scope.getRepScope.mockResolvedValue({ level: 'self', repIds: ['rep-1'] });
    const findMany = jest.fn().mockResolvedValue([]);
    (prisma.expenseReport as unknown as { findMany: jest.Mock }).findMany = findMany;
    await service.list({}, user);
    const where = (findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[0]).toEqual({ OR: [{ submitted_by: 'u1' }, { rep_id: { in: ['rep-1'] } }] });
  });

  it('all scope (admin) applies no rep restriction', async () => {
    const { service, prisma, scope } = make();
    scope.getRepScope.mockResolvedValue({ level: 'all' });
    const findMany = jest.fn().mockResolvedValue([]);
    (prisma.expenseReport as unknown as { findMany: jest.Mock }).findMany = findMany;
    await service.list({}, superAdmin);
    const where = (findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[0]).toEqual({});
  });
});
