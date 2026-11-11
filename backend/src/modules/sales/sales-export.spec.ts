/**
 * Sales export log — client request 2026-11-11.
 *   - RECORDED FIRST: the log row + exactly which sales, in one transaction, before rows are returned;
 *   - SCOPED like the list (§5): a rep's export holds only their own sales;
 *   - only_new excludes any sale already in an earlier sales export (company-wide);
 *   - more than the cap → 422, nothing recorded.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { MAX_EXPORT_ROWS, SalesService } from './sales.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user = (id: string): AuthUser => ({
  id,
  email: `${id}@x.co`,
  full_name: id,
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(['sales:export']),
  repId: null,
});

function make(opts: { scope?: { level: 'all' | 'self' | 'roster'; repIds: string[] }; count?: number; rows?: unknown[] } = {}) {
  const tx = {
    reportExport: { create: jest.fn().mockResolvedValue({ id: 'exp-1', generated_at: new Date(0), only_new: false, format: 'excel' }) },
    reportExportSale: { createMany: jest.fn() },
  };
  const prisma = {
    sale: {
      count: jest.fn().mockResolvedValue(opts.count ?? 2),
      findMany: jest.fn().mockResolvedValue(opts.rows ?? [
        { id: 's1', sale_date: new Date('2026-11-10T00:00:00Z'), rep: null },
        { id: 's2', sale_date: new Date('2026-11-09T00:00:00Z'), rep: null },
      ]),
    },
    payPeriod: { findMany: jest.fn().mockResolvedValue([]) },
    reportExport: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn() };
  const scope = { getRepScope: jest.fn().mockResolvedValue(opts.scope ?? { level: 'all', repIds: [] }) };
  const service = new SalesService(prisma as never, audit as never, scope as never, {} as never);
  return { service, prisma, tx, audit };
}

const whereOf = (prisma: ReturnType<typeof make>['prisma']) =>
  (prisma.sale.findMany.mock.calls[0][0] as { where: unknown }).where;

describe('SalesService.exportSales', () => {
  it('records the export AND exactly which sales it held, in one transaction', async () => {
    const { service, tx } = make();
    const res = await service.exportSales({ format: 'excel', filename: 'f', filters: { status: 'paid' } }, user('sa'));
    expect(tx.reportExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ report_type: 'sales', format: 'excel', row_count: 2, only_new: false, generated_by: 'sa', scope_filters: { status: 'paid' } }),
    });
    expect(tx.reportExportSale.createMany).toHaveBeenCalledWith({
      data: [{ report_export_id: 'exp-1', sale_id: 's1' }, { report_export_id: 'exp-1', sale_id: 's2' }],
    });
    expect(res.rows).toHaveLength(2);
  });

  it('only_new excludes any sale already in an earlier export', async () => {
    const { service, prisma } = make();
    await service.exportSales({ format: 'csv', filename: 'f', only_new: true }, user('sa'));
    expect(JSON.stringify(whereOf(prisma))).toContain('"export_links":{"none":{}}');
  });

  it('is SCOPED like the list — a rep exports only their own sales', async () => {
    const { service, prisma } = make({ scope: { level: 'self', repIds: ['rep-A'] } });
    await service.exportSales({ format: 'csv', filename: 'f' }, user('rep-user'));
    expect(JSON.stringify(whereOf(prisma))).toContain('"rep_id":{"in":["rep-A"]}');
  });

  it('over the cap → 422 and NOTHING is recorded', async () => {
    const { service, prisma } = make({ count: MAX_EXPORT_ROWS + 1 });
    await expect(service.exportSales({ format: 'csv', filename: 'f' }, user('sa'))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('nothing matching → no file, so NOTHING is logged (no empty history entries)', async () => {
    const { service, prisma } = make({ count: 0, rows: [] });
    const res = await service.exportSales({ format: 'csv', filename: 'f', only_new: true }, user('sa'));
    expect(res).toEqual({ export: null, rows: [] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('SalesService.exportSummary / listExports', () => {
  it('counts matching vs never-exported sales and returns the last export', async () => {
    const { service, prisma } = make();
    prisma.sale.count.mockResolvedValueOnce(214).mockResolvedValueOnce(37);
    prisma.reportExport.findFirst.mockResolvedValue({
      id: 'e', generated_at: new Date(0), format: 'excel', filename: 'f', row_count: 177, only_new: false,
      scope_filters: {}, generator: { full_name: 'Super Admin' },
    });
    const s = await service.exportSummary({}, user('sa'));
    expect(s).toMatchObject({ matching: 214, not_yet_exported: 37, last_export: { generated_by_name: 'Super Admin', row_count: 177 } });
  });

  it('a caller who does not see all sales sees only their OWN exports', async () => {
    const { service, prisma } = make({ scope: { level: 'self', repIds: ['rep-A'] } });
    await service.listExports({ page: 1, limit: 20 } as never, user('rep-user'));
    expect(prisma.reportExport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { report_type: 'sales', generated_by: 'rep-user' } }),
    );
  });
});
