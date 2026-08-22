/**
 * Rep pay statement — the SECURITY properties, which are the point of packet 03.
 *
 * A rep must never see another rep's lines, any client billing rate, or an org-wide total. Two of those
 * are enforced structurally rather than by a check that could be forgotten:
 *
 *   - The self-service surface takes NO repId. There is no parameter through which another rep could be
 *     named, so "rep A requests rep B" is not a request this API can express. The spec asserts that shape
 *     directly, because a validation check can be removed while a missing parameter cannot.
 *   - The rep-facing DTO is a SEPARATE type from the admin one. The spec asserts the response's own key
 *     set, so adding a field to the admin serializer can never leak it here.
 *
 * Per §14 rule 10: if this fails, an invariant broke — fix the code, not the spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PayRunService } from './pay-run.service';

const dec = (v: string) => new Decimal(v);
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const LINE = {
  sale_id: 'sale-a',
  sale_date: d('2026-03-02'),
  customer_name: 'Tim',
  address: '12 Main St',
  channel: 'VF',
  product_name: 'Fibre 1gig/2.5gig',
  has_internet: true,
  has_tv: true,
  has_home_phone: false,
  is_greenfield: false,
  internet_rate: dec('145'),
  tv_rate: dec('30'),
  hp_rate: dec('0'),
  greenfield: dec('0'),
  spiff: dec('0'),
  other_total: dec('0'),
  total_100: dec('175'),
  advance_70: dec('122.50'),
  holdback_30: dec('52.50'),
  sort_order: 0,
};

function make(opts: { lines?: unknown[]; saleIds?: string[] } = {}) {
  const prisma = {
    payRun: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'run-1',
        status: 'finalized',
        pay_period: { period_number: 6, start_date: d('2026-03-01'), end_date: d('2026-03-14') },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payrollReportLine: { findMany: jest.fn().mockResolvedValue(opts.lines ?? [LINE]) },
    sale: { findMany: jest.fn().mockResolvedValue((opts.saleIds ?? ['sale-a']).map((id) => ({ id, pay_run_id: 'run-1' }))) },
    rep: { findUnique: jest.fn().mockResolvedValue({ rep_code: 'RW-D-0001', external_code: 'Redwave11', full_name: 'Rep A' }) },
  };
  const service = new PayRunService(
    prisma as never, { log: jest.fn() } as never, { getRepScope: jest.fn() } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { service, prisma };
}

const user = (repId: string | null) => ({ id: 'u1', repId }) as never;

describe('Rep pay statement — self-scoping comes from the TOKEN', () => {
  it('resolves the rep from the authenticated user, never from a parameter', async () => {
    const { service, prisma } = make();
    await service.myPayStatement('run-1', user('rep-A'));
    // The sale filter used the token's rep id — nothing the caller supplied.
    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pay_run_id: 'run-1', rep_id: 'rep-A' } }),
    );
  });

  // The strongest form of the guarantee: there is no parameter to attack.
  it('the self-service routes declare NO repId parameter at all', () => {
    const src = fs.readFileSync(path.join(__dirname, 'pay-run.controller.ts'), 'utf8');
    const selfController = src.slice(src.indexOf('class PayStatementsController'));
    expect(selfController).not.toMatch(/repId/);
    expect(selfController).toMatch(/@RequirePermission\('pay_statements', 'view'\)/);
  });

  // 403, not an empty 200 — "you have no statements" and "you are not a rep" are different facts.
  it('403s a user with no linked rep rather than returning an empty statement', async () => {
    const { service } = make();
    await expect(service.myPayStatement('run-1', user(null))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.myPayStatements(user(null))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s an unknown run', async () => {
    const { service, prisma } = make();
    prisma.payRun.findUnique.mockResolvedValue(null);
    await expect(service.myPayStatement('nope', user('rep-A'))).rejects.toBeInstanceOf(NotFoundException);
  });

  // Rep A asking for a run in which they sold nothing gets an EMPTY statement, never rep B's lines.
  it("returns no lines for a run the caller had no sales in — never another rep's", async () => {
    const { service, prisma } = make({ saleIds: [] });
    prisma.payrollReportLine.findMany.mockResolvedValue([]);
    const statement = await service.myPayStatement('run-1', user('rep-B'));
    expect(statement.lines).toEqual([]);
    expect(statement.is_finalized).toBe(false);
    expect(prisma.payrollReportLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pay_run_id: 'run-1', sale_id: { in: [] } } }),
    );
  });
});

describe('Rep pay statement — what a rep may NOT see (#3)', () => {
  it('carries no client rate, margin or org-wide field', async () => {
    const { service } = make();
    const statement = await service.myPayStatement('run-1', user('rep-A'));
    const keys = Object.keys(statement.lines[0]);
    // Assert the exact allowed key set: a field added to the admin serializer cannot appear here unless
    // someone also adds it to this list, which is a deliberate act rather than an accident.
    expect(keys.sort()).toEqual(
      [
        'address', 'advance_70', 'channel', 'customer_name', 'greenfield', 'has_home_phone',
        'has_internet', 'has_tv', 'holdback_30', 'hp_rate', 'internet_rate', 'is_greenfield',
        'other_total', 'product_name', 'sale_date', 'sale_id', 'spiff', 'total_100', 'tv_rate',
      ].sort(),
    );
    for (const forbidden of ['client_rate', 'billing_rate', 'margin', 'line_total', 'rep_external_code']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('the rep-facing DTO is its OWN type, not the admin payroll line', () => {
    const src = fs.readFileSync(path.join(__dirname, 'dto', 'pay-run.response.ts'), 'utf8');
    expect(src).toMatch(/class RepPayStatementLineResponse/);
    // It must not simply extend the admin line, which would inherit whatever that gains later.
    expect(src).not.toMatch(/class RepPayStatementLineResponse\s+extends/);
  });
});

describe('Rep pay statement — reconciles with the payroll report', () => {
  it('totals equal the sum of the rep\'s own frozen lines, never recomputed', async () => {
    const second = { ...LINE, sale_id: 'sale-b', total_100: dec('110'), advance_70: dec('77'), holdback_30: dec('33') };
    const { service } = make({ lines: [LINE, second], saleIds: ['sale-a', 'sale-b'] });
    const statement = await service.myPayStatement('run-1', user('rep-A'));
    expect(statement.total_100).toBe('285.00'); // 175 + 110
    expect(statement.advance_70).toBe('199.50'); // 122.50 + 77
    expect(statement.holdback_30).toBe('85.50'); // 52.50 + 33
    // The split still adds up exactly — the same frozen numbers the payroll report prints.
    expect(Number(statement.advance_70) + Number(statement.holdback_30)).toBeCloseTo(Number(statement.total_100), 2);
  });

  it('the admin path returns the same statement for the same rep', async () => {
    const { service } = make();
    const mine = await service.myPayStatement('run-1', user('rep-A'));
    const admin = await service.repPayStatement('run-1', 'rep-A');
    expect(admin.total_100).toBe(mine.total_100);
    expect(admin.lines).toHaveLength(mine.lines.length);
  });
});
