import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ExpenseReportsService } from './expense-report.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user = { id: 'u1', repId: 'rep-1', isSuperAdmin: false, roleNames: [], permissions: new Set<string>() } as unknown as AuthUser;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dec = (s: string) => ({ toString: () => s });

const folder = { id: 'r1', name: 'Week of 2026-07-06', submitted_by: 'u1', rep_id: 'rep-1', week_start: d('2026-07-06'), week_end: d('2026-07-12'), created_at: d('2026-07-06') };

function make(opts: { items?: unknown[]; existingForWeek?: unknown } = {}) {
  const tx = {
    expenseKmLog: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    expenseKmStop: { deleteMany: jest.fn() },
    expenseItem: { deleteMany: jest.fn() },
    expenseReport: { delete: jest.fn() },
  };
  const prisma = {
    expenseReport: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'r1', ...data })),
      findMany: jest.fn().mockResolvedValue([folder]),
      count: jest.fn().mockResolvedValue(1),
      // create() looks for the caller's EXISTING folder for the same rep+week FIRST (returns null by
      // default = a genuinely new week); every other caller of findFirst is a scoped lookup by id.
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve('week_start' in where ? (opts.existingForWeek ?? null) : folder),
        ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...folder, ...data })),
    },
    expenseItem: { findMany: jest.fn().mockResolvedValue(opts.items ?? []) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const scope = { getRepScope: jest.fn().mockResolvedValue({ level: 'all' }) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const expenses = {
    loadConfigs: jest.fn().mockResolvedValue(new Map()),
    itemValidation: jest.fn().mockReturnValue({ alerts: [], warnings: [], alert_count: 0, warning_count: 0 }),
    assertManageableReport: jest.fn().mockResolvedValue(folder),
    submitReportItems: jest.fn().mockResolvedValue(2),
    bulkReview: jest.fn().mockResolvedValue({ reviewed: 2, skipped: 0 }),
  };
  const service = new ExpenseReportsService(prisma as never, scope as never, expenses as never, audit as never);
  return { service, prisma, scope, audit, expenses, tx };
}

const item = (over: Record<string, unknown> = {}) => ({
  status: 'draft',
  is_personal: false,
  amount_cad: dec('20.00'),
  category: 'meals',
  amount: dec('20.00'),
  receipt_url: 'r',
  field_values: {},
  km_log: null,
  ...over,
});

describe('ExpenseReportsService', () => {
  it('create → a fresh folder is empty (status empty, zero total)', async () => {
    const { service, prisma } = make();
    const res = await service.create({ name: 'W', week_start: '2026-07-06', week_end: '2026-07-12' }, user);
    expect(res).toMatchObject({ item_count: 0, total_reimbursable_cad: '0.00', status: 'empty', reused: false });
    expect(prisma.expenseReport.create).toHaveBeenCalled();
  });

  /**
   * A week is ONE container by design: two folders for the same rep+week is how items get submitted twice
   * or missed at review. A second "new report" is the rep looking for the folder they already made. — EXP-001
   */
  describe('create — one folder per rep + week', () => {
    it('RESOLVES to the existing folder instead of creating a duplicate', async () => {
      const { service, prisma } = make({
        existingForWeek: folder,
        items: [item({ amount_cad: dec('20.00') }), item({ amount_cad: dec('30.00') })],
      });
      const res = await service.create({ name: 'Another name', week_start: '2026-07-06', week_end: '2026-07-12' }, user);

      expect(prisma.expenseReport.create).not.toHaveBeenCalled();
      expect(res).toMatchObject({ id: 'r1', reused: true });
      // …and it comes back with its LIVE aggregates, not a pretend-empty shell.
      expect(res.total_reimbursable_cad).toBe('50.00');
      expect(res.item_count).toBe(2);
    });

    it('matches on submitter + rep + week_start', async () => {
      const { service, prisma } = make();
      await service.create({ name: 'W', week_start: '2026-07-06', week_end: '2026-07-12' }, user);
      expect(prisma.expenseReport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { submitted_by: 'u1', rep_id: 'rep-1', week_start: d('2026-07-06') },
          orderBy: { created_at: 'asc' }, // the ORIGINAL folder, not the newest duplicate
        }),
      );
    });

    it('a DIFFERENT week still creates a new folder', async () => {
      const { service, prisma } = make(); // no existing folder for that week
      const res = await service.create({ name: 'W', week_start: '2026-07-13', week_end: '2026-07-19' }, user);
      expect(prisma.expenseReport.create).toHaveBeenCalled();
      expect(res.reused).toBe(false);
    });
  });

  it('list → derives status + Σ amount_cad total + aggregated validation per folder', async () => {
    const { service, expenses } = make({ items: [item({ expense_report_id: 'r1', status: 'submitted', amount_cad: dec('20.00') }), item({ expense_report_id: 'r1', status: 'submitted', amount_cad: dec('30.00') })] });
    // one item flagged (a warning)
    expenses.itemValidation.mockReturnValueOnce({ alerts: [], warnings: [{ code: 'x' }], alert_count: 0, warning_count: 1 });
    const page = await service.list({}, user);
    const f = page.data[0];
    expect(f.total_reimbursable_cad).toBe('50.00'); // 20 + 30
    expect(f.status).toBe('pending'); // both submitted, none draft/sent_back → pending
    expect(f.item_count).toBe(2);
    expect(f.validation).toEqual({ alert_count: 0, warning_count: 1, flagged: 1 });
  });

  it('list awaiting_review=true → filters to folders with a submitted item (the approval queue)', async () => {
    const { service, prisma } = make();
    await service.list({ awaiting_review: 'true' } as never, user);
    const where = prisma.expenseReport.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ expense_items: { some: { status: 'submitted' } } });
  });

  it('list total EXCLUDES personal items (EXP-012)', async () => {
    const { service } = make({ items: [item({ expense_report_id: 'r1', amount_cad: dec('20.00') }), item({ expense_report_id: 'r1', is_personal: true, amount_cad: dec('99.00') })] });
    expect((await service.list({}, user)).data[0].total_reimbursable_cad).toBe('20.00');
  });

  it('detail → folder + its items each with a validation block', async () => {
    const { service } = make({ items: [item({ id: 'i1', expense_date: d('2026-07-07') })] });
    const res = await service.findOne('r1', user);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toHaveProperty('validation');
  });

  it('remove → 422 when the folder has an approved item', async () => {
    const { service, prisma } = make();
    prisma.expenseItem.findMany.mockResolvedValue([{ id: 'i1', status: 'approved' }]);
    await expect(service.remove('r1', user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('remove → cascade-deletes unapproved items + the folder', async () => {
    const { service, prisma, tx } = make();
    prisma.expenseItem.findMany.mockResolvedValue([{ id: 'i1', status: 'draft' }, { id: 'i2', status: 'sent_back' }]);
    await service.remove('r1', user);
    expect(tx.expenseItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['i1', 'i2'] } } });
    expect(tx.expenseReport.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('submit → delegates to submitReportItems; 422 when nothing to submit', async () => {
    const { service, expenses } = make();
    await service.submit('r1', user);
    expect(expenses.submitReportItems).toHaveBeenCalledWith('r1', user);
    expenses.submitReportItems.mockResolvedValue(0);
    await expect(service.submit('r1', user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('review → bulk-reviews the folder’s reviewable items; 422 when none awaiting', async () => {
    const { service, prisma, expenses } = make();
    prisma.expenseItem.findMany.mockResolvedValueOnce([{ id: 'i1' }, { id: 'i2' }]); // reviewable
    const res = await service.review('r1', { decision: 'approve' as never }, user);
    expect(expenses.bulkReview).toHaveBeenCalledWith({ ids: ['i1', 'i2'], decision: 'approve', note: undefined }, user);
    expect(res).toMatchObject({ reviewed: 2, skipped: 0 });

    prisma.expenseItem.findMany.mockResolvedValue([]); // nothing reviewable
    await expect(service.review('r1', { decision: 'approve' as never }, user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('review → 404 when the folder is out of scope', async () => {
    const { service, prisma } = make();
    prisma.expenseReport.findFirst.mockResolvedValue(null);
    await expect(service.review('r1', { decision: 'approve' as never }, user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
