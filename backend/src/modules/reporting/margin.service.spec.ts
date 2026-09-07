/**
 * Margin reporting — the SANCTIONED #3 crossing, and the conditions that make it legitimate.
 *
 * Packet 07 permits this one read to put a client rate and a rep rate on the same row, because the spread
 * IS Redwave's earning. The conditions are what these tests protect:
 *
 *   - two SEPARATE queries joined in memory, with NO Prisma relation between the streams
 *   - read-only: it never feeds a rate, a commission or a document
 *   - Super Admin only, because margin is commercially sensitive
 *   - currencies are never summed (#12)
 *
 * Per §14 rule 10: if one of these fails, an invariant broke — fix the code, not the spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';
import { MarginService } from './margin.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dec = (v: string) => ({ toString: () => v });

const billedLine = (over: Record<string, unknown> = {}) => ({
  sale_id: 'sale-1',
  sale_date: d('2026-03-02'),
  customer_name: 'Tim',
  product_name: 'Fibre 1gig/2.5gig',
  channel: 'VF',
  rep_code: 'RW-D-0001',
  rep_name: 'Rep A',
  line_total: dec('350.00'),
  statement: { currency: 'CAD' },
  ...over,
});

function make(opts: { billed?: unknown[]; paid?: unknown[] } = {}) {
  const prisma = {
    clientStatementLine: { findMany: jest.fn().mockResolvedValue(opts.billed ?? [billedLine()]) },
    payrollReportLine: {
      findMany: jest.fn().mockResolvedValue(opts.paid ?? [{ sale_id: 'sale-1', total_100: dec('145.00') }]),
    },
    clientBillingRate: { findMany: jest.fn().mockResolvedValue([]) },
    commissionTierRate: { findMany: jest.fn().mockResolvedValue([]) },
    commissionFlatRate: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new MarginService(prisma as never, audit as never), prisma, audit };
}

const sa = { id: 'sa', isSuperAdmin: true, roleNames: [] } as never;
const admin = { id: 'a1', isSuperAdmin: false, roleNames: ['Admin'] } as never;
const rep = { id: 'r1', isSuperAdmin: false, roleNames: ['Sales Rep'] } as never;

describe('Margin — who may see it', () => {
  // Margin exposes what Redwave earns on every sale. The packet: gate it away from rep-facing roles.
  it('403s a Sales Rep', async () => {
    const { service } = make();
    await expect(service.perSale(rep, '2026-03-01', '2026-03-31')).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Even an Admin — the decorator says reports:business, and the service re-checks so a future role grant
  // cannot quietly widen access.
  it('403s a plain Admin, not just a rep', async () => {
    const { service } = make();
    await expect(service.perSale(admin, '2026-03-01', '2026-03-31')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('audits the denial rather than failing silently', async () => {
    const { service, audit } = make();
    await expect(service.perSale(rep, '2026-03-01', '2026-03-31')).rejects.toThrow();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied' }));
  });

  it('allows a Super Admin', async () => {
    const { service } = make();
    await expect(service.perSale(sa, '2026-03-01', '2026-03-31')).resolves.toBeDefined();
  });
});

describe('Margin — the arithmetic', () => {
  it('is client bill minus rep pay, with a percentage of the bill', async () => {
    const { service } = make();
    const [row] = await service.perSale(sa, '2026-03-01', '2026-03-31');
    expect(row.client_billed).toBe('350.00');
    expect(row.rep_paid).toBe('145.00');
    expect(row.margin).toBe('205.00');
    expect(row.margin_pct).toBe('58.6');
  });

  // The two calendars mean a sale is routinely billed before it is paid. Zero rep cost is the truth for
  // that row, not a gap — but the margin is not final, which is why the UI labels it.
  it('a sale billed but not yet paid shows zero rep pay, not a missing row', async () => {
    const { service } = make({ paid: [] });
    const [row] = await service.perSale(sa, '2026-03-01', '2026-03-31');
    expect(row.rep_paid).toBe('0.00');
    expect(row.margin).toBe('350.00');
  });

  // A negative margin is a real business fact — never hidden or floored (§13.6).
  it('shows a NEGATIVE margin when the rep was paid more than the client was billed', async () => {
    const { service } = make({
      billed: [billedLine({ line_total: dec('100.00') })],
      paid: [{ sale_id: 'sale-1', total_100: dec('145.00') }],
    });
    const [row] = await service.perSale(sa, '2026-03-01', '2026-03-31');
    expect(row.margin).toBe('-45.00');
    expect(row.margin_pct).toBe('-45.0');
  });

  it('reports a null percentage rather than dividing by zero', async () => {
    const { service } = make({ billed: [billedLine({ line_total: dec('0.00') })] });
    const [row] = await service.perSale(sa, '2026-03-01', '2026-03-31');
    expect(row.margin_pct).toBeNull();
  });
});

describe('Margin — #3: the streams are queried separately and joined in memory', () => {
  it('issues TWO independent queries, neither referencing the other', async () => {
    const { service, prisma } = make();
    await service.perSale(sa, '2026-03-01', '2026-03-31');

    // The client-side read touches only client-billing tables…
    const billedArgs = prisma.clientStatementLine.findMany.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(Object.keys(billedArgs.select)).not.toContain('payroll_report_lines');
    // …and the rep-side read touches only rep-pay tables, selecting nothing about billing.
    const paidArgs = prisma.payrollReportLine.findMany.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(Object.keys(paidArgs.select).sort()).toEqual(['sale_id', 'total_100']);
  });

  it('only ISSUED statements count — a superseded version is history, not what is owed', async () => {
    const { service, prisma } = make();
    await service.perSale(sa, '2026-03-01', '2026-03-31');
    const args = prisma.clientStatementLine.findMany.mock.calls[0][0] as {
      where: { statement: { status: string } };
    };
    expect(args.where.statement.status).toBe('issued');
  });

  // The guard the packet is most explicit about: no relation may be added between the streams.
  it('the schema declares NO relation between a payroll line and any client-billing table', () => {
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model = schema.slice(schema.indexOf('model PayrollReportLine'));
    const body = model.slice(0, model.indexOf('\n}'));
    for (const forbidden of ['ClientStatement', 'ClientInvoice', 'ClientBillingRate', 'BillingPeriod']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('margin code lives ONLY in reporting/ — none in billing, payrun, engine or commission', () => {
    const modules = path.join(__dirname, '..');
    const offenders: string[] = [];
    for (const dir of ['billing', 'payrun', 'engine', 'commission']) {
      const full = path.join(modules, dir);
      if (!fs.existsSync(full)) continue;
      const walk = (p: string): void => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const child = path.join(p, e.name);
          if (e.isDirectory()) walk(child);
          else if (e.isFile() && child.endsWith('.ts') && !child.endsWith('.spec.ts')) {
            // Strip COMMENTS first. Several of those files legitimately say "no margin" to document the
            // absence, and matching that text would flag the very statements asserting the invariant holds.
            // `net_margin` is the dashboards' CASH margin — a different, already-sanctioned figure.
            const code = fs
              .readFileSync(child, 'utf8')
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/\/\/[^\n]*/g, '')
              .replace(/net_margin/g, '');
            if (/\bmargin\b/i.test(code)) offenders.push(child);
          }
        }
      };
      walk(full);
    }
    expect(offenders).toEqual([]);
  });
});

describe('Margin — #12: currencies are never summed', () => {
  it('keeps a USD client in its own group rather than folding it into a CAD total', async () => {
    const { service } = make({
      billed: [
        billedLine({ sale_id: 's-cad', channel: 'VF', line_total: dec('350.00'), statement: { currency: 'CAD' } }),
        billedLine({ sale_id: 's-usd', channel: 'CTI', line_total: dec('250.00'), statement: { currency: 'USD' } }),
      ],
      paid: [
        { sale_id: 's-cad', total_100: dec('145.00') },
        { sale_id: 's-usd', total_100: dec('100.00') },
      ],
    });
    const groups = await service.rollup(sa, '2026-03-01', '2026-03-31', 'client');
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.currency).sort()).toEqual(['CAD', 'USD']);
    // Never 600.00 — that would be adding dollars of two different kinds.
    expect(groups.every((g) => g.client_billed !== '600.00')).toBe(true);
  });

  it('carries the document currency onto every row', async () => {
    const { service } = make({ billed: [billedLine({ statement: { currency: 'USD' } })] });
    const [row] = await service.perSale(sa, '2026-03-01', '2026-03-31');
    expect(row.currency).toBe('USD');
  });
});

describe('Margin — roll-ups', () => {
  it('groups by product and sums within one currency', async () => {
    const { service } = make({
      billed: [
        billedLine({ sale_id: 's1', product_name: 'Fibre 1gig', line_total: dec('350.00') }),
        billedLine({ sale_id: 's2', product_name: 'Fibre 1gig', line_total: dec('350.00') }),
        billedLine({ sale_id: 's3', product_name: 'TV', line_total: dec('50.00') }),
      ],
      paid: [
        { sale_id: 's1', total_100: dec('145.00') },
        { sale_id: 's2', total_100: dec('145.00') },
        { sale_id: 's3', total_100: dec('30.00') },
      ],
    });
    const groups = await service.rollup(sa, '2026-03-01', '2026-03-31', 'product');
    const fibre = groups.find((g) => g.label === 'Fibre 1gig')!;
    expect(fibre.sale_count).toBe(2);
    expect(fibre.client_billed).toBe('700.00');
    expect(fibre.rep_paid).toBe('290.00');
    expect(fibre.margin).toBe('410.00');
  });

  it('orders by margin, largest first', async () => {
    const { service } = make({
      billed: [
        billedLine({ sale_id: 's1', product_name: 'Small', line_total: dec('60.00') }),
        billedLine({ sale_id: 's2', product_name: 'Big', line_total: dec('350.00') }),
      ],
      paid: [
        { sale_id: 's1', total_100: dec('30.00') },
        { sale_id: 's2', total_100: dec('145.00') },
      ],
    });
    const groups = await service.rollup(sa, '2026-03-01', '2026-03-31', 'product');
    expect(groups[0].label).toBe('Big');
  });
});

describe('Margin — rates in force', () => {
  it('reports EVERY tier bracket for a tiered product, not one number', async () => {
    const { service, prisma } = make();
    prisma.clientBillingRate.findMany.mockResolvedValue([
      {
        product_id: 'p1',
        amount: dec('350.00'),
        effective_from: d('2026-01-01'),
        effective_to: null,
        client: { client_code: 'VF', currency: 'CAD' },
        product: { name: 'Fibre 1gig', product_type: 'internet' },
      },
    ]);
    prisma.commissionTierRate.findMany.mockResolvedValue([
      { product_id: 'p1', tier_number: 2, amount: dec('145.00') },
      { product_id: 'p1', tier_number: 4, amount: dec('110.00') },
    ]);

    const [row] = await service.ratesInForce(sa, '2026-09-07');
    expect(row.client_rate).toBe('350.00');
    // Sorted, and complete — a rep's internet rate depends on the period's volume.
    expect(row.rep_tier_rates.map((t) => t.tier_number)).toEqual([2, 4]);
  });

  it("falls back to a product TYPE's flat rate when the product has none of its own", async () => {
    const { service, prisma } = make();
    prisma.clientBillingRate.findMany.mockResolvedValue([
      {
        product_id: 'p-tv',
        amount: dec('50.00'),
        effective_from: d('2026-01-01'),
        effective_to: null,
        client: { client_code: 'VF', currency: 'CAD' },
        product: { name: 'TV', product_type: 'tv' },
      },
    ]);
    prisma.commissionFlatRate.findMany.mockResolvedValue([
      { product_id: null, product_type: 'tv', amount: dec('30.00') },
    ]);

    const [row] = await service.ratesInForce(sa, '2026-09-07');
    expect(row.rep_flat_rate).toBe('30.00');
  });

  it('403s a non-Super-Admin', async () => {
    const { service } = make();
    await expect(service.ratesInForce(admin, '2026-09-07')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
