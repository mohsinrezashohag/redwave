import { ForbiddenException } from '@nestjs/common';
import { ReportExportsService } from './report-exports.service';
import type { CreateReportExportDto } from './dto/report-export.dto';
import type { AuthUser } from '../../common/rbac/auth-user.type';

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 'u-1',
    email: 'u@x.co',
    full_name: 'U',
    status: 'active',
    roleNames: [],
    isSuperAdmin: false,
    permissions: new Set<string>(),
    repId: null,
    ...over,
  }) as AuthUser;

function makeService(opts: { scopeLevel?: 'all' | 'roster' | 'self'; repIds?: string[] } = {}) {
  const prisma = {
    reportExport: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'exp-1', ...data, generated_at: new Date() })),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scope = {
    getRepScope: jest.fn().mockResolvedValue({ level: opts.scopeLevel ?? 'all', repIds: opts.repIds ?? [] }),
  };
  const service = new ReportExportsService(prisma as never, audit as never, scope as never);
  return { service, prisma, audit, scope };
}

const dto = (over: Partial<CreateReportExportDto> = {}): CreateReportExportDto =>
  ({ report_type: 'leaderboard', format: 'csv', filename: 'leaderboard.csv', ...over }) as CreateReportExportDto;

describe('ReportExportsService.record — per-type permission gate (NO new permission; existing keys)', () => {
  const CASES: Array<[CreateReportExportDto['report_type'], string]> = [
    ['business_summary', 'reports:business'],
    ['leaderboard', 'reports:view'],
    ['payrun_summary', 'payrun:export'],
    ['expense_summary', 'expenses:export'],
  ];

  it.each(CASES)('%s requires %s — allowed when held', async (report_type, perm) => {
    const { service, prisma } = makeService();
    const u = user({ permissions: new Set([perm]) });
    const rec = await service.record(dto({ report_type }), u);
    expect(prisma.reportExport.create).toHaveBeenCalled();
    expect(rec.report_type).toBe(report_type);
  });

  it.each(CASES)('%s without %s → 403 + access_denied audit, NOTHING recorded', async (report_type, perm) => {
    const { service, prisma, audit } = makeService();
    const u = user({ permissions: new Set(['some:other']) });
    await expect(service.record(dto({ report_type }), u)).rejects.toThrow(ForbiddenException);
    expect(prisma.reportExport.create).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access_denied', after: expect.objectContaining({ reason: expect.stringContaining(perm) }) }),
    );
  });
});

describe('ReportExportsService.record — recorded content', () => {
  it('records who/what/when + an export audit row', async () => {
    const { service, prisma, audit } = makeService();
    const u = user({ permissions: new Set(['reports:view']) });
    await service.record(dto({ format: 'pdf', filename: 'leaderboard.pdf' }), u);

    expect(prisma.reportExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ generated_by: 'u-1', report_type: 'leaderboard', format: 'pdf', filename: 'leaderboard.pdf' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export', entityType: 'report_exports', entityId: 'exp-1' }),
    );
  });

  it('REP-SCOPED types (payrun/expense) record the caller rep_scope — a manager records the roster', async () => {
    const { service, prisma, scope } = makeService({ scopeLevel: 'roster', repIds: ['r-1', 'r-2'] });
    const u = user({ permissions: new Set(['expenses:export']) });
    await service.record(dto({ report_type: 'expense_summary', from: '2026-01-04', to: '2026-01-17' }), u);

    expect(scope.getRepScope).toHaveBeenCalledWith(u);
    const data = (prisma.reportExport.create.mock.calls[0][0] as { data: { scope_filters: Record<string, unknown> } }).data;
    expect(data.scope_filters).toEqual({ pay_period_id: null, from: '2026-01-04', to: '2026-01-17', rep_scope: ['r-1', 'r-2'] });
  });

  it('an admin-level scope records rep_scope null (= all)', async () => {
    const { service, prisma } = makeService({ scopeLevel: 'all' });
    const u = user({ permissions: new Set(['payrun:export']), roleNames: ['Admin'] });
    await service.record(dto({ report_type: 'payrun_summary', pay_period_id: 'p-1' }), u);
    const data = (prisma.reportExport.create.mock.calls[0][0] as { data: { scope_filters: Record<string, unknown> } }).data;
    expect(data.scope_filters).toEqual(expect.objectContaining({ pay_period_id: 'p-1', rep_scope: null }));
  });

  it('NON-rep-scoped types (business/leaderboard) never call getRepScope (rep_scope null)', async () => {
    const { service, prisma, scope } = makeService();
    const u = user({ permissions: new Set(['reports:business']), isSuperAdmin: true });
    await service.record(dto({ report_type: 'business_summary', format: 'excel', filename: 'biz.xlsx' }), u);
    expect(scope.getRepScope).not.toHaveBeenCalled();
    const data = (prisma.reportExport.create.mock.calls[0][0] as { data: { scope_filters: Record<string, unknown> } }).data;
    expect(data.scope_filters).toEqual(expect.objectContaining({ rep_scope: null }));
  });
});

describe('ReportExportsService.list — own for non-admin, all for Admin/SA', () => {
  it('a non-admin lists ONLY their own records', async () => {
    const { service, prisma } = makeService();
    await service.list(user({ roleNames: ['Manager'] }));
    expect(prisma.reportExport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { generated_by: 'u-1' }, take: 50 }),
    );
  });

  it('Admin / Super Admin list all', async () => {
    const { service, prisma } = makeService();
    await service.list(user({ roleNames: ['Admin'] }));
    expect(prisma.reportExport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));

    await service.list(user({ isSuperAdmin: true }));
    expect(prisma.reportExport.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });
});
