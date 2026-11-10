/**
 * Payroll-line BACKFILL — for runs finalized before `payroll_report_lines` existed (packet 02).
 *
 * The properties that matter: the lines are rebuilt from the FROZEN snapshots only and RECONCILE to the
 * frozen pay-run line (#2/#5 — nothing is recomputed or re-tiered); no snapshot is written; a mismatch writes
 * nothing; the operation is idempotent; and it refuses a run that never finalized.
 */
import { ConflictException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PayRunService } from './pay-run.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const pd = (v: string) => new Prisma.Decimal(v);

const REP = { rep_code: 'RW-D-0002', external_code: 'Redwave20', full_name: 'Sam Stone' };

// Sam: one household with internet ($145) + TV ($30), one greenfield internet ($100, out of the tally #9).
// Gross 275 → 70% 192.50 / 30% 82.50.
const SALES = [
  {
    id: 'sale-1',
    rep_id: 'rep-sam',
    sale_date: d('2026-05-12'),
    customer_name: 'Tim',
    street: '1 Main St',
    city: 'Winnipeg',
    province_state: 'MB',
    postal_code: null,
    is_greenfield: false,
    rep: REP,
    client: { client_code: 'VF' },
    sale_items: [
      { id: 'i-1', product_type: 'internet', counts_toward_tally: true, product: { name: 'Fibre 1gig' }, rate_applied: pd('145'), incentive_amount: pd('0'), commission_paid: pd('145') },
      { id: 'i-2', product_type: 'tv', counts_toward_tally: false, product: null, rate_applied: pd('30'), incentive_amount: null, commission_paid: pd('30') },
    ],
  },
  {
    id: 'sale-2',
    rep_id: 'rep-sam',
    sale_date: d('2026-05-14'),
    customer_name: 'Ann',
    street: null,
    city: null,
    province_state: null,
    postal_code: null,
    is_greenfield: true,
    rep: REP,
    client: { client_code: 'RF' },
    sale_items: [
      { id: 'i-3', product_type: 'internet', counts_toward_tally: false, product: { name: 'Fibre 500' }, rate_applied: pd('100'), incentive_amount: pd('0'), commission_paid: pd('100') },
    ],
  },
];

function make(opts: { status?: string; existing?: number; commission70?: string; sales?: unknown[] } = {}) {
  const prisma = {
    payRun: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'run-10',
        status: opts.status ?? 'exported',
        pay_period: { period_number: 10, start_date: d('2026-05-10'), end_date: d('2026-05-23') },
      }),
    },
    payrollReportLine: {
      count: jest.fn().mockResolvedValue(opts.existing ?? 0),
      create: jest.fn().mockResolvedValue({}),
    },
    payRunLine: {
      findMany: jest.fn().mockResolvedValue([
        {
          rep_id: 'rep-sam',
          rep: { rep_code: 'RW-D-0002' },
          gross_commission: pd('275.00'),
          commission_70: pd(opts.commission70 ?? '192.50'),
        },
      ]),
    },
    sale: { findMany: jest.fn().mockResolvedValue(opts.sales ?? SALES) },
    // Deliberately NO saleItem / client-billing delegates: touching a snapshot (#2) or a client rate (#3)
    // would throw here.
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const audit = { log: jest.fn() };
  const config = { getEngineConfig: jest.fn().mockResolvedValue({ holdback: { advancePct: new Decimal('0.7') } }) };
  const service = new PayRunService(
    prisma as never, audit as never, {} as never, config as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { service, prisma, audit, config };
}

const written = (prisma: ReturnType<typeof make>['prisma']) =>
  prisma.payrollReportLine.create.mock.calls.map(([arg]) => arg.data as Record<string, unknown>);

const sum = (rows: Record<string, unknown>[], key: string) =>
  rows.reduce((acc, r) => acc.plus(new Decimal(String(r[key]))), new Decimal(0)).toFixed(2);

describe('backfillPayrollLines', () => {
  it('rebuilds one line per sale from the frozen snapshots, reconciling to the pay-run line', async () => {
    const { service, prisma, audit } = make();
    const r = await service.backfillPayrollLines('run-10', { dryRun: false, actorId: 'sa' });

    expect(r.outcome).toBe('written');
    expect(r.reps).toEqual([
      { rep_code: 'RW-D-0002', sales: 2, gross: '275.00', advance_70: '192.50', held_30: '82.50' },
    ]);
    const rows = written(prisma);
    expect(rows).toHaveLength(2);
    expect(sum(rows, 'total_100')).toBe('275.00');
    expect(sum(rows, 'advance_70')).toBe('192.50');
    expect(sum(rows, 'holdback_30')).toBe('82.50');
    // Greenfield lands in its own column, not internet (#9).
    const gf = rows.find((x) => x.sale_id === 'sale-2')!;
    expect(gf.greenfield).toBe('100.00');
    expect(gf.internet_rate).toBe('0.00');
    // As-of close, like finalize (#10).
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'backfill_payroll_lines', actorId: 'sa' }));
  });

  it('a dry run checks everything and writes nothing', async () => {
    const { service, prisma, audit } = make();
    const r = await service.backfillPayrollLines('run-10', { dryRun: true, actorId: 'sa' });
    expect(r.outcome).toBe('would_write');
    expect(r.reps[0].advance_70).toBe('192.50');
    expect(prisma.payrollReportLine.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('is idempotent — a run that already has lines is left untouched', async () => {
    const { service, prisma } = make({ existing: 4 });
    const r = await service.backfillPayrollLines('run-10', { dryRun: false, actorId: 'sa' });
    expect(r.outcome).toBe('skipped_has_lines');
    expect(prisma.payrollReportLine.create).not.toHaveBeenCalled();
  });

  it('refuses a run that never finalized', async () => {
    const { service } = make({ status: 'draft' });
    await expect(service.backfillPayrollLines('run-10', { dryRun: false, actorId: 'sa' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('a snapshot/pay-run mismatch refuses and writes NOTHING', async () => {
    const { service, prisma } = make({ commission70: '200.00' });
    await expect(service.backfillPayrollLines('run-10', { dryRun: false, actorId: 'sa' })).rejects.toThrow(
      /RW-D-0002/,
    );
    expect(prisma.payrollReportLine.create).not.toHaveBeenCalled();
  });

  it('refuses a paid sale whose rep has no pay-run line, rather than silently dropping it', async () => {
    const stray = { ...SALES[1], id: 'sale-x', rep_id: 'rep-other' };
    const { service, prisma } = make({ sales: [...SALES, stray] });
    await expect(service.backfillPayrollLines('run-10', { dryRun: false, actorId: 'sa' })).rejects.toThrow(/sale-x/);
    expect(prisma.payrollReportLine.create).not.toHaveBeenCalled();
  });

  it('ignores items never frozen in this run (commission_paid null)', async () => {
    const unpaid = { ...SALES[0].sale_items[1], id: 'i-unpaid', rate_applied: null, commission_paid: null };
    const sales = [{ ...SALES[0], sale_items: [...SALES[0].sale_items, unpaid] }, SALES[1]];
    const { service, prisma } = make({ sales });
    await service.backfillPayrollLines('run-10', { dryRun: false, actorId: 'sa' });
    expect(sum(written(prisma), 'total_100')).toBe('275.00');
  });
});
