import { UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { StatementService } from './statement.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// A sale row as returned by the service's findMany select. product_type drives bundle matching (defaults
// to the product_id so a sale without explicit types matches no bundle).
const sale = (
  id: string,
  customer: string,
  saleDate: string,
  items: { product_id: string; name: string; product_type?: string }[],
) => ({
  id,
  customer_name: customer,
  sale_date: d(saleDate),
  sale_items: items.map((i) => ({ product_id: i.product_id, product_type: i.product_type ?? i.product_id, product: { name: i.name } })),
});

const rate = (productId: string, from: string, to: string | null, amount: string) => ({
  id: `r-${productId}-${from}`,
  product_id: productId,
  effective_from: d(from),
  effective_to: to ? d(to) : null,
  amount: { toString: () => amount },
});

// A bundle_bonus rate (client-wide, product_id null) with its trigger product-type set.
const bundle = (triggerTypes: string[], from: string, to: string | null, amount: string) => ({
  id: `b-${triggerTypes.join('_')}-${from}`,
  effective_from: d(from),
  effective_to: to ? d(to) : null,
  amount: { toString: () => amount },
  bundle_product_types: triggerTypes,
});

/** Sequence stub — mints 1, 2, 3 … (the real one row-locks document_sequences inside the tx). */
const seqStub = () => {
  let n = 0;
  return { next: jest.fn(async () => (n += 1)) };
};

function make(opts: {
  sales: ReturnType<typeof sale>[];
  rates: ReturnType<typeof rate>[];
  bundles?: ReturnType<typeof bundle>[];
  priorStatementId?: string | null;
}) {
  const tx = {
    clientStatement: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'stmt-new', statement_number: data.statement_number, lines: data.lines.create })),
      // The prior CURRENT version (if any) found AFTER create, to be superseded.
      findFirst: jest.fn().mockResolvedValue(opts.priorStatementId ? { id: opts.priorStatementId } : null),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'stmt-prior', ...data })),
    },
    clientStatementLine: { deleteMany: jest.fn() },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', client_code: 'VF', currency: 'CAD' }) },
    payPeriod: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'P1',
        period_number: 3,
        start_date: d('2026-01-01'),
        end_date: d('2026-01-31'),
      }),
    },
    sale: { findMany: jest.fn().mockResolvedValue(opts.sales) },
    // priceClientPeriod queries product rates then bundle rates — return each by rate_kind.
    clientBillingRate: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { rate_kind?: string } }) =>
        Promise.resolve(where.rate_kind === 'bundle_bonus' ? (opts.bundles ?? []) : opts.rates),
      ),
    },
    productTypeCatalogue: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'internet', label: 'Internet' },
        { key: 'home_phone', label: 'Home Phone' },
        { key: 'tv', label: 'TV' },
      ]),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // FX source OFF by default (CAD client → resolveIssueFx short-circuits to rate 1 without calling it).
  const fx = { getRateToCad: jest.fn().mockResolvedValue(null), isAutoEnabled: jest.fn().mockReturnValue(false) };
  const service = new StatementService(prisma as never, audit as never, seqStub() as never, fx as never, { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never);
  return { service, prisma, tx, audit, fx };
}

const createData = (tx: ReturnType<typeof make>['tx']) =>
  (tx.clientStatement.create.mock.calls[0][0] as { data: { total_amount: string; statement_number: number; lines: { create: { line_total: string; products_summary?: string }[] } } }).data;

describe('StatementService.generate (SRS §12 — immutable, gapless)', () => {
  it('prices each sale from client_billing_rates effective on its OWN sale_date (rate change mid-period)', async () => {
    const { service, tx } = make({
      sales: [
        sale('s-early', 'Early', '2026-01-10', [{ product_id: 'p', name: 'Internet' }]),
        sale('s-late', 'Late', '2026-01-20', [{ product_id: 'p', name: 'Internet' }]),
      ],
      rates: [
        rate('p', '2026-01-01', '2026-01-14', '50.00'), // in force for the early sale
        rate('p', '2026-01-15', null, '60.00'), // supersedes — in force for the late sale
      ],
    });
    await service.generate('c1', 'P1', 'admin');
    const data = createData(tx);
    expect(data.lines.create.map((l) => l.line_total)).toEqual(['50.00', '60.00']);
    expect(data.total_amount).toBe('110.00'); // exact Decimal, #10 effective-dating
  });

  it('mints a gapless statement_number on issue', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
    });
    await service.generate('c1', 'P1', 'admin');
    expect(createData(tx).statement_number).toBe(1);
  });

  it('one line per sale aggregating all its products; NO tax/GST field on output (#BILL-004)', async () => {
    const { service, tx } = make({
      sales: [
        sale('s1', 'Jane', '2026-01-10', [
          { product_id: 'int', name: 'Internet' },
          { product_id: 'tv', name: 'TV' },
          { product_id: 'hp', name: 'Home Phone' },
        ]),
      ],
      rates: [
        rate('int', '2026-01-01', null, '60.00'),
        rate('tv', '2026-01-01', null, '25.00'),
        rate('hp', '2026-01-01', null, '15.00'),
      ],
    });
    await service.generate('c1', 'P1', 'admin');
    const data = createData(tx);
    expect(data.lines.create).toHaveLength(1);
    const line = data.lines.create[0];
    expect(line.products_summary).toBe('Internet, TV, Home Phone');
    expect(line.line_total).toBe('100.00');
    const keys = Object.keys(line).join(',') + ',' + Object.keys(data).join(',');
    expect(keys.toLowerCase()).not.toMatch(/tax|gst|pst|vat/);
  });

  it('a sold product with no effective billing rate → 422 (never silently under-bill)', async () => {
    const { service } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'no-rate', name: 'Internet' }])],
      rates: [],
    });
    await expect(service.generate('c1', 'P1', 'admin')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('IMMUTABLE: regeneration CREATES a new version + supersedes the prior (never deletes/mutates lines)', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
      priorStatementId: 'stmt-prior',
    });
    await service.generate('c1', 'P1', 'admin');
    // A NEW version was created…
    expect(tx.clientStatement.create).toHaveBeenCalledTimes(1);
    // …and the prior current version was marked superseded (metadata only — pointer to the new one).
    expect(tx.clientStatement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stmt-prior' },
        data: expect.objectContaining({ status: 'superseded', superseded_by_id: 'stmt-new' }),
      }),
    );
    // Lines are NEVER deleted (the issued document is immutable).
    expect(tx.clientStatementLine.deleteMany).not.toHaveBeenCalled();
  });

  it('first issue (no prior) supersedes nothing', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
    });
    await service.generate('c1', 'P1', 'admin');
    expect(tx.clientStatement.update).not.toHaveBeenCalled();
  });

  it('excludes clawed-back items; a sale with no remaining items contributes no line', async () => {
    const { service, tx } = make({
      sales: [sale('s-empty', 'Gone', '2026-01-10', [])],
      rates: [],
    });
    await service.generate('c1', 'P1', 'admin');
    const data = createData(tx);
    expect(data.lines.create).toHaveLength(0);
    expect(data.total_amount).toBe('0.00');
  });

  it('unknown client / period → 404', async () => {
    const { service, prisma } = make({ sales: [], rates: [] });
    prisma.client.findUnique.mockResolvedValueOnce(null);
    await expect(service.generate('nope', 'P1', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StatementService.generate — FX frozen at ISSUE (#12)', () => {
  const fxData = (tx: ReturnType<typeof make>['tx']) =>
    (tx.clientStatement.create.mock.calls[0][0] as { data: { currency: string; fx_rate: string; amount_cad: string; total_amount: string } }).data;

  it('CAD client → currency CAD, fx_rate 1, amount_cad = total (NO FX fetch)', async () => {
    const { service, tx, fx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
    });
    await service.generate('c1', 'P1', 'admin');
    const data = fxData(tx);
    expect(data.currency).toBe('CAD');
    expect(data.fx_rate).toBe('1.00000000');
    expect(data.amount_cad).toBe('60.00');
    expect(fx.getRateToCad).not.toHaveBeenCalled();
  });

  // The FIRST real source-driven conversion: a USD client, NO override → resolveIssueFx pulls the rate from
  // the FX source (Bank of Canada). 250 USD × 1.365 = 341.25 CAD frozen at issue. — Meeting 3 rate-grid track
  it('USD client + FX SOURCE (no override) → freezes the source rate + amount_cad = total × rate', async () => {
    const { service, tx, prisma, fx } = make({
      sales: [sale('s1', 'CTI-Cust', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '250.00')],
    });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    fx.getRateToCad.mockResolvedValue(new Decimal('1.365'));
    await service.generate('c1', 'P1', 'admin'); // NO override → the source supplies the rate
    expect(fx.getRateToCad).toHaveBeenCalledWith('USD', expect.any(Date));
    const data = fxData(tx);
    expect(data.currency).toBe('USD');
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.total_amount).toBe('250.00'); // in USD
    expect(data.amount_cad).toBe('341.25'); // 250 × 1.365, frozen
  });

  it('USD client + override → freezes currency USD, the override rate, and amount_cad', async () => {
    const { service, tx, prisma } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '100.00')],
    });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    await service.generate('c1', 'P1', 'admin', '1.36500000');
    const data = fxData(tx);
    expect(data.currency).toBe('USD');
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.total_amount).toBe('100.00'); // in USD (the client's currency)
    expect(data.amount_cad).toBe('136.50'); // frozen CAD = 100 × 1.365
  });

  // Rounding-boundary on ISSUE: 10.00 USD × 1.3625 = 13.625 → 13.63 HALF-UP (not 13.62 half-even).
  it('freezes amount_cad HALF-UP at a .xx5 boundary (10.00 × 1.3625 = 13.625 → 13.63)', async () => {
    const { service, tx, prisma } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '10.00')],
    });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    await service.generate('c1', 'P1', 'admin', '1.3625');
    expect(fxData(tx).amount_cad).toBe('13.63');
  });

  it('USD client, NO override + FX source OFF → 422 (never guess a rate)', async () => {
    const { service, prisma } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '100.00')],
    });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    await expect(service.generate('c1', 'P1', 'admin')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('preview freezes NOTHING (no create, no number, no rate)', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
    });
    await service.preview('c1', 'P1');
    expect(tx.clientStatement.create).not.toHaveBeenCalled();
  });
});

describe('StatementService — bundle_bonus applied to line totals (BILL-013)', () => {
  const bundleData = (tx: ReturnType<typeof make>['tx']) =>
    (tx.clientStatement.create.mock.calls[0][0] as {
      data: { total_amount: string; amount_cad: string; currency: string; fx_rate: string; lines: { create: { line_total: string; products_summary: string }[] } };
    }).data;

  const hpTv = (id: string, saleDate = '2026-01-10') =>
    sale(id, 'Jane', saleDate, [
      { product_id: 'hp', name: 'Home Phone', product_type: 'home_phone' },
      { product_id: 'tv', name: 'TV', product_type: 'tv' },
    ]);
  const hpTvRates = [rate('hp', '2026-01-01', null, '90.00'), rate('tv', '2026-01-01', null, '100.00')];

  it('a sale with HP+TV → the bundle is added to the line total + shown in the summary', async () => {
    const { service, tx } = make({ sales: [hpTv('s1')], rates: hpTvRates, bundles: [bundle(['home_phone', 'tv'], '2026-01-01', null, '35.00')] });
    await service.generate('c1', 'P1', 'admin');
    const data = bundleData(tx);
    expect(data.total_amount).toBe('225.00'); // 90 + 100 + 35
    expect(data.lines.create[0].line_total).toBe('225.00');
    expect(data.lines.create[0].products_summary).toContain('Home Phone + TV bundle');
  });

  it('a sale with only HP (no TV) → the bundle does NOT apply', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'hp', name: 'Home Phone', product_type: 'home_phone' }])],
      rates: [rate('hp', '2026-01-01', null, '90.00')],
      bundles: [bundle(['home_phone', 'tv'], '2026-01-01', null, '35.00')],
    });
    await service.generate('c1', 'P1', 'admin');
    expect(bundleData(tx).total_amount).toBe('90.00');
  });

  it('applies the bundle ONCE for internet+HP+TV', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [
        { product_id: 'int', name: 'Internet', product_type: 'internet' },
        { product_id: 'hp', name: 'Home Phone', product_type: 'home_phone' },
        { product_id: 'tv', name: 'TV', product_type: 'tv' },
      ])],
      rates: [rate('int', '2026-01-01', null, '280.00'), ...hpTvRates],
      bundles: [bundle(['home_phone', 'tv'], '2026-01-01', null, '35.00')],
    });
    await service.generate('c1', 'P1', 'admin');
    const data = bundleData(tx);
    expect(data.total_amount).toBe('505.00'); // 280 + 90 + 100 + 35
    expect(data.lines.create[0].products_summary.match(/bundle/g)?.length).toBe(1);
  });

  it('bundle effective-dating: a future-dated bundle is NOT applied to an earlier sale', async () => {
    const { service, tx } = make({ sales: [hpTv('s1')], rates: hpTvRates, bundles: [bundle(['home_phone', 'tv'], '2026-02-01', null, '35.00')] });
    await service.generate('c1', 'P1', 'admin');
    expect(bundleData(tx).total_amount).toBe('190.00'); // bundle not yet effective on 2026-01-10
  });

  // The requested end-to-end: a USD client whose total includes an add-on AND a bundle, frozen to CAD at issue.
  it('USD statement total includes add-on + bundle → frozen amount_cad (BILL-013 × #12)', async () => {
    const { service, tx, prisma, fx } = make({
      sales: [sale('s1', 'CTI-Cust', '2026-01-10', [
        { product_id: 'int', name: 'Internet', product_type: 'internet' },
        { product_id: 'hp', name: 'Home Phone', product_type: 'home_phone' },
        { product_id: 'tv', name: 'TV', product_type: 'tv' },
      ])],
      rates: [rate('int', '2026-01-01', null, '250.00'), rate('hp', '2026-01-01', null, '50.00'), rate('tv', '2026-01-01', null, '50.00')],
      bundles: [bundle(['home_phone', 'tv'], '2026-01-01', null, '35.00')],
    });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    fx.getRateToCad.mockResolvedValue(new Decimal('1.365')); // FX source supplies the rate
    await service.generate('c1', 'P1', 'admin');
    const data = bundleData(tx);
    expect(data.currency).toBe('USD');
    expect(data.total_amount).toBe('385.00'); // 250 + 50 + 50 + 35 USD
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.amount_cad).toBe('525.53'); // 385 × 1.365 = 525.525 → half-up
  });
});
