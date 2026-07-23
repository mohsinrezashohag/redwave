import { UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { StatementService } from './statement.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// A sale row as returned by the service's findMany select. product_type drives component + bundle matching
// (defaults to the product_id so a sale without explicit types is treated as an unknown add-on type).
const sale = (
  id: string,
  customer: string,
  saleDate: string,
  items: { product_id: string; name: string; product_type?: string }[],
) => ({
  id,
  customer_name: customer,
  customer_first_name: null,
  customer_last_name: null,
  street: '12 Main St',
  city: 'Winnipeg',
  province_state: 'MB',
  postal_code: 'R3C 1A1',
  sale_date: d(saleDate),
  rep: { rep_code: 'RW-D-0001', full_name: 'Test Rep' },
  sale_items: items.map((i) => ({
    product_id: i.product_id,
    product_type: i.product_type ?? i.product_id,
    product: { name: i.name },
  })),
});

const rate = (productId: string, from: string, to: string | null, amount: string) => ({
  id: `r-${productId}-${from}`,
  product_id: productId,
  rate_kind: 'product' as const,
  effective_from: d(from),
  effective_to: to ? d(to) : null,
  amount: { toString: () => amount },
  bundle_product_types: [] as string[],
});

/** A client-wide rate of one of the non-product kinds (tv_addon / hp_addon / spiff). */
const kindRate = (rateKind: string, from: string, to: string | null, amount: string) => ({
  id: `k-${rateKind}-${from}`,
  product_id: null,
  rate_kind: rateKind,
  effective_from: d(from),
  effective_to: to ? d(to) : null,
  amount: { toString: () => amount },
  bundle_product_types: [] as string[],
});

// A bundle_bonus rate (client-wide, product_id null) with its trigger product-type set.
const bundle = (triggerTypes: string[], from: string, to: string | null, amount: string) => ({
  id: `b-${triggerTypes.join('_')}-${from}`,
  product_id: null,
  rate_kind: 'bundle_bonus' as const,
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

type AnyRate = ReturnType<typeof rate> | ReturnType<typeof kindRate> | ReturnType<typeof bundle>;

function make(opts: {
  sales: ReturnType<typeof sale>[];
  rates: AnyRate[];
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
    billingPeriod: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        period_number: 27,
        start_date: d('2026-06-29'), // Monday
        end_date: d('2026-07-05'), // Sunday
      }),
    },
    sale: { findMany: jest.fn().mockResolvedValue(opts.sales) },
    // priceClientPeriod reads EVERY rate kind in one query and splits them in memory.
    clientBillingRate: { findMany: jest.fn().mockResolvedValue(opts.rates) },
    productTypeCatalogue: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'internet', label: 'Internet', behaviour: 'tiered' },
        { key: 'greenfield_internet', label: 'Greenfield Internet', behaviour: 'greenfield' },
        { key: 'home_phone', label: 'Home Phone', behaviour: 'standard_addon' },
        { key: 'tv', label: 'TV', behaviour: 'standard_addon' },
        { key: 'protection_plan', label: 'Protection Plan', behaviour: 'standard_addon' },
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

interface CreatedLine {
  line_total: string;
  products_summary?: string;
  internet_rate: string;
  tv_rate: string;
  hp_rate: string;
  bundle_bonus: string;
  spiff: string;
  other_total: string;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  rep_code: string;
  rep_name: string;
  address: string;
  channel: string;
  product_name: string;
  customer_first_name: string;
  customer_last_name: string;
  sale_date: string;
}

const createData = (tx: ReturnType<typeof make>['tx']) =>
  (tx.clientStatement.create.mock.calls[0][0] as {
    data: {
      total_amount: string;
      statement_number: number;
      spiff_from: Date | null;
      spiff_to: Date | null;
      lines: { create: CreatedLine[] };
    };
  }).data;

describe('StatementService.generate (SRS §12 — immutable, gapless)', () => {
  it('prices each sale from client_billing_rates effective on its OWN sale_date (rate change mid-week)', async () => {
    const { service, tx } = make({
      sales: [
        sale('s-early', 'Early Cust', '2026-06-29', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }]),
        sale('s-late', 'Late Cust', '2026-07-02', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }]),
      ],
      rates: [
        rate('p', '2026-01-01', '2026-06-30', '50.00'), // in force for the early sale
        rate('p', '2026-07-01', null, '60.00'), // supersedes — in force for the late sale
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const data = createData(tx);
    expect(data.lines.create.map((l) => l.line_total)).toEqual(['50.00', '60.00']);
    expect(data.total_amount).toBe('110.00'); // exact Decimal, #10 effective-dating
  });

  it('mints a gapless statement_number on issue', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
    });
    await service.generate('c1', 'B1', 'admin');
    expect(createData(tx).statement_number).toBe(1);
  });

  it('one row per sale with per-component amounts; NO tax/GST field on output (#BILL-004)', async () => {
    const { service, tx } = make({
      sales: [
        sale('s1', 'Jane Doe', '2026-06-29', [
          { product_id: 'int', name: 'Fibre 1gig/2.5gig', product_type: 'internet' },
          { product_id: 'tv', name: 'TV', product_type: 'tv' },
          { product_id: 'hp', name: 'Home Phone', product_type: 'home_phone' },
        ]),
      ],
      rates: [
        rate('int', '2026-01-01', null, '350.00'),
        rate('tv', '2026-01-01', null, '50.00'),
        rate('hp', '2026-01-01', null, '50.00'),
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const data = createData(tx);
    expect(data.lines.create).toHaveLength(1);
    const line = data.lines.create[0];
    expect(line.internet_rate).toBe('350.00');
    expect(line.tv_rate).toBe('50.00');
    expect(line.hp_rate).toBe('50.00');
    expect(line.line_total).toBe('450.00');
    expect(line.products_summary).toBe('Fibre 1gig/2.5gig, TV, Home Phone');
    const keys = Object.keys(line).join(',') + ',' + Object.keys(data).join(',');
    expect(keys.toLowerCase()).not.toMatch(/tax|gst|pst|vat/);
  });

  it('freezes the who/where/what the client workbook prints', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'int', name: 'Fibre 1gig/2.5gig', product_type: 'internet' }])],
      rates: [rate('int', '2026-01-01', null, '350.00')],
    });
    await service.generate('c1', 'B1', 'admin');
    const line = createData(tx).lines.create[0];
    expect(line.rep_code).toBe('RW-D-0001');
    expect(line.rep_name).toBe('Test Rep');
    expect(line.address).toBe('12 Main St, Winnipeg, MB, R3C 1A1');
    expect(line.channel).toBe('VF');
    expect(line.product_name).toBe('Fibre 1gig/2.5gig'); // the internet SPEED, not the add-ons
    expect(line.customer_first_name).toBe('Jane'); // split from the legacy single name
    expect(line.customer_last_name).toBe('Doe');
    expect(line.has_internet).toBe(true);
  });

  it('a sold product with no effective billing rate → 422 (never silently under-bill)', async () => {
    const { service } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'no-rate', name: 'Internet', product_type: 'internet' }])],
      rates: [],
    });
    await expect(service.generate('c1', 'B1', 'admin')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('IMMUTABLE: regeneration CREATES a new version + supersedes the prior (never deletes/mutates lines)', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
      priorStatementId: 'stmt-prior',
    });
    await service.generate('c1', 'B1', 'admin');
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

  it('supersession is scoped to the (client, BILLING WEEK) — not the pay period', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
      priorStatementId: 'stmt-prior',
    });
    await service.generate('c1', 'B1', 'admin');
    expect(tx.clientStatement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ client_id: 'c1', billing_period_id: 'B1', status: 'issued' }),
      }),
    );
  });

  it('first issue (no prior) supersedes nothing', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
    });
    await service.generate('c1', 'B1', 'admin');
    expect(tx.clientStatement.update).not.toHaveBeenCalled();
  });

  it('excludes clawed-back items; a sale with no remaining items contributes no line', async () => {
    const { service, tx } = make({ sales: [sale('s-empty', 'Gone', '2026-06-29', [])], rates: [] });
    await service.generate('c1', 'B1', 'admin');
    const data = createData(tx);
    expect(data.lines.create).toHaveLength(0);
    expect(data.total_amount).toBe('0.00');
  });

  it('selects sales by sale_date within the BILLING WEEK', async () => {
    const { service, prisma } = make({ sales: [], rates: [] });
    await service.generate('c1', 'B1', 'admin');
    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sale_date: { gte: d('2026-06-29'), lte: d('2026-07-05') } }),
      }),
    );
  });

  it('unknown client / billing week → 404', async () => {
    const { service, prisma } = make({ sales: [], rates: [] });
    prisma.client.findUnique.mockResolvedValueOnce(null);
    await expect(service.generate('nope', 'B1', 'admin')).rejects.toBeInstanceOf(NotFoundException);

    const second = make({ sales: [], rates: [] });
    second.prisma.billingPeriod.findUnique.mockResolvedValueOnce(null);
    await expect(second.service.generate('c1', 'nope', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * The rate kinds that previously had NO code path. Each resolves independently on the sale_date; TV and Home
 * Phone take the client-wide add-on kind when one is in force and FALL BACK to the product rate otherwise, so
 * a client billing them as products keeps billing exactly as before and the two can never stack.
 */
describe('StatementService — every rate kind is applied (BILL-007)', () => {
  const householdSale = () =>
    sale('s1', 'Jane Doe', '2026-06-29', [
      { product_id: 'int', name: 'Fibre 1gig/2.5gig', product_type: 'internet' },
      { product_id: 'tv', name: 'TV', product_type: 'tv' },
      { product_id: 'hp', name: 'Home Phone', product_type: 'home_phone' },
    ]);

  it('tv_addon / hp_addon WIN over the TV/HP product rates (never both — no double-billing)', async () => {
    const { service, tx } = make({
      sales: [householdSale()],
      rates: [
        rate('int', '2026-01-01', null, '350.00'),
        rate('tv', '2026-01-01', null, '10.00'), // would be used only as the fallback
        rate('hp', '2026-01-01', null, '10.00'),
        kindRate('tv_addon', '2026-01-01', null, '50.00'),
        kindRate('hp_addon', '2026-01-01', null, '50.00'),
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const line = createData(tx).lines.create[0];
    expect(line.tv_rate).toBe('50.00'); // the add-on kind, not 10.00
    expect(line.hp_rate).toBe('50.00');
    expect(line.line_total).toBe('450.00'); // 350 + 50 + 50 — the product rates did NOT also apply
  });

  it('with NO add-on kind configured, the TV/HP PRODUCT rate is used (today’s data bills identically)', async () => {
    const { service, tx } = make({
      sales: [householdSale()],
      rates: [
        rate('int', '2026-01-01', null, '350.00'),
        rate('tv', '2026-01-01', null, '50.00'),
        rate('hp', '2026-01-01', null, '50.00'),
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const line = createData(tx).lines.create[0];
    expect(line.tv_rate).toBe('50.00');
    expect(line.hp_rate).toBe('50.00');
    expect(line.line_total).toBe('450.00');
  });

  it('an add-on kind is effective-dated on the sale_date like every other rate (#10)', async () => {
    const { service, tx } = make({
      sales: [
        sale('s-before', 'Before', '2026-06-29', [
          { product_id: 'int', name: 'Internet', product_type: 'internet' },
          { product_id: 'tv', name: 'TV', product_type: 'tv' },
        ]),
        sale('s-after', 'After', '2026-07-02', [
          { product_id: 'int', name: 'Internet', product_type: 'internet' },
          { product_id: 'tv', name: 'TV', product_type: 'tv' },
        ]),
      ],
      rates: [
        rate('int', '2026-01-01', null, '350.00'),
        rate('tv', '2026-01-01', null, '20.00'), // the fallback, in force throughout
        kindRate('tv_addon', '2026-07-01', null, '50.00'), // starts mid-week
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const [before, after] = createData(tx).lines.create;
    expect(before.tv_rate).toBe('20.00'); // add-on not yet in force → product fallback
    expect(after.tv_rate).toBe('50.00'); // add-on in force
  });

  it('a TV product priced by NEITHER its own rate nor an add-on → 422 (still never under-bill)', async () => {
    const { service } = make({
      sales: [householdSale()],
      rates: [rate('int', '2026-01-01', null, '350.00')], // no tv/hp rate of any kind
    });
    await expect(service.generate('c1', 'B1', 'admin')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a spiff applies only INSIDE its own window, and its window is frozen for the column header', async () => {
    const { service, tx } = make({
      sales: [
        sale('s-in', 'In window', '2026-06-30', [{ product_id: 'int', name: 'Internet', product_type: 'internet' }]),
        sale('s-out', 'Out of window', '2026-07-04', [{ product_id: 'int', name: 'Internet', product_type: 'internet' }]),
      ],
      rates: [
        rate('int', '2026-01-01', null, '350.00'),
        kindRate('spiff', '2026-06-29', '2026-07-01', '30.00'),
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const data = createData(tx);
    expect(data.lines.create[0].spiff).toBe('30.00');
    expect(data.lines.create[1].spiff).toBe('0.00'); // outside the spiff window
    expect(data.spiff_from).toEqual(d('2026-06-29'));
    expect(data.spiff_to).toEqual(d('2026-07-01'));
  });

  it('the bundle bonus applies when ALL its trigger types are on the sale (config-driven)', async () => {
    const { service, tx } = make({
      sales: [
        householdSale(),
        sale('s-no-bundle', 'Internet only', '2026-06-29', [{ product_id: 'int', name: 'Internet', product_type: 'internet' }]),
      ],
      rates: [
        rate('int', '2026-01-01', null, '350.00'),
        rate('tv', '2026-01-01', null, '50.00'),
        rate('hp', '2026-01-01', null, '50.00'),
        bundle(['home_phone', 'tv'], '2026-01-01', null, '35.00'),
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const [withBundle, without] = createData(tx).lines.create;
    expect(withBundle.bundle_bonus).toBe('35.00');
    expect(withBundle.line_total).toBe('485.00'); // 350 + 50 + 50 + 35
    expect(without.bundle_bonus).toBe('0.00');
  });

  it('a priced product with no column of its own lands in other_total — never dropped from the bill', async () => {
    const { service, tx } = make({
      sales: [
        sale('s1', 'Jane Doe', '2026-06-29', [
          { product_id: 'int', name: 'Internet', product_type: 'internet' },
          { product_id: 'pp', name: 'Protection Plan', product_type: 'protection_plan' },
        ]),
      ],
      rates: [rate('int', '2026-01-01', null, '350.00'), rate('pp', '2026-01-01', null, '50.00')],
    });
    await service.generate('c1', 'B1', 'admin');
    const line = createData(tx).lines.create[0];
    expect(line.other_total).toBe('50.00');
    expect(line.line_total).toBe('400.00'); // the add-on is still billed
  });

  it('greenfield internet counts as Internet for the presence flag + Product column (#9 is a COMMISSION rule)', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'gf', name: 'Greenfield Fibre', product_type: 'greenfield_internet' }])],
      rates: [rate('gf', '2026-01-01', null, '400.00')],
    });
    await service.generate('c1', 'B1', 'admin');
    const line = createData(tx).lines.create[0];
    expect(line.has_internet).toBe(true);
    expect(line.product_name).toBe('Greenfield Fibre');
    expect(line.internet_rate).toBe('400.00');
  });

  it('line_total always equals the sum of the six components (#1 — no lost cent)', async () => {
    const { service, tx } = make({
      sales: [householdSale()],
      rates: [
        rate('int', '2026-01-01', null, '333.33'),
        kindRate('tv_addon', '2026-01-01', null, '11.11'),
        kindRate('hp_addon', '2026-01-01', null, '22.22'),
        kindRate('spiff', '2026-01-01', null, '0.01'),
        bundle(['home_phone', 'tv'], '2026-01-01', null, '5.55'),
      ],
    });
    await service.generate('c1', 'B1', 'admin');
    const line = createData(tx).lines.create[0];
    const sum = [line.internet_rate, line.tv_rate, line.hp_rate, line.bundle_bonus, line.spiff, line.other_total]
      .reduce((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
    expect(line.line_total).toBe(sum.toFixed(2));
    expect(line.line_total).toBe('372.22');
  });
});

describe('StatementService.generate — FX frozen at ISSUE (#12)', () => {
  const fxData = (tx: ReturnType<typeof make>['tx']) =>
    (tx.clientStatement.create.mock.calls[0][0] as { data: { currency: string; fx_rate: string; amount_cad: string; total_amount: string } }).data;

  const oneSale = () => [sale('s1', 'Jane Doe', '2026-06-29', [{ product_id: 'p', name: 'Internet', product_type: 'internet' }])];

  it('CAD client → currency CAD, fx_rate 1, amount_cad = total (NO FX fetch)', async () => {
    const { service, tx, fx } = make({ sales: oneSale(), rates: [rate('p', '2026-01-01', null, '60.00')] });
    await service.generate('c1', 'B1', 'admin');
    const data = fxData(tx);
    expect(data.currency).toBe('CAD');
    expect(data.fx_rate).toBe('1.00000000');
    expect(data.amount_cad).toBe('60.00');
    expect(fx.getRateToCad).not.toHaveBeenCalled();
  });

  // The FIRST real source-driven conversion: a USD client, NO override → resolveIssueFx pulls the rate from
  // the FX source (Bank of Canada). 250 USD × 1.365 = 341.25 CAD frozen at issue. — Meeting 3 rate-grid track
  it('USD client + FX SOURCE (no override) → freezes the source rate + amount_cad = total × rate', async () => {
    const { service, tx, prisma, fx } = make({ sales: oneSale(), rates: [rate('p', '2026-01-01', null, '250.00')] });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    fx.getRateToCad.mockResolvedValue(new Decimal('1.365'));
    await service.generate('c1', 'B1', 'admin'); // NO override → the source supplies the rate
    expect(fx.getRateToCad).toHaveBeenCalledWith('USD', expect.any(Date));
    const data = fxData(tx);
    expect(data.currency).toBe('USD');
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.total_amount).toBe('250.00'); // in USD
    expect(data.amount_cad).toBe('341.25'); // 250 × 1.365, frozen
  });

  it('USD client + override → freezes currency USD, the override rate, and amount_cad', async () => {
    const { service, tx, prisma } = make({ sales: oneSale(), rates: [rate('p', '2026-01-01', null, '100.00')] });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    await service.generate('c1', 'B1', 'admin', '1.36500000');
    const data = fxData(tx);
    expect(data.currency).toBe('USD');
    expect(data.fx_rate).toBe('1.36500000');
    expect(data.total_amount).toBe('100.00'); // in USD (the client's currency)
    expect(data.amount_cad).toBe('136.50'); // frozen CAD = 100 × 1.365
  });

  // Rounding-boundary on ISSUE: 10.00 USD × 1.3625 = 13.625 → 13.63 HALF-UP (not 13.62 half-even).
  it('freezes amount_cad HALF-UP at a .xx5 boundary (10.00 × 1.3625 = 13.625 → 13.63)', async () => {
    const { service, tx, prisma } = make({ sales: oneSale(), rates: [rate('p', '2026-01-01', null, '10.00')] });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    await service.generate('c1', 'B1', 'admin', '1.3625');
    expect(fxData(tx).amount_cad).toBe('13.63');
  });

  it('USD client, NO override + FX source OFF → 422 (never guess a rate)', async () => {
    const { service, prisma } = make({ sales: oneSale(), rates: [rate('p', '2026-01-01', null, '100.00')] });
    prisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', client_code: 'CTI', currency: 'USD' });
    await expect(service.generate('c1', 'B1', 'admin')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('preview freezes NOTHING (no create, no number, no rate) but returns the same rows + summary', async () => {
    const { service, tx } = make({
      sales: [
        sale('s1', 'Jane Doe', '2026-06-29', [
          { product_id: 'int', name: 'Internet', product_type: 'internet' },
          { product_id: 'tv', name: 'TV', product_type: 'tv' },
        ]),
      ],
      rates: [rate('int', '2026-01-01', null, '350.00'), kindRate('tv_addon', '2026-01-01', null, '50.00')],
    });
    const preview = await service.preview('c1', 'B1');
    expect(tx.clientStatement.create).not.toHaveBeenCalled();
    expect(preview.lines[0].line_total).toBe('400.00');
    expect(preview.summary.internet_count).toBe(1);
    expect(preview.summary.tv_count).toBe(1);
    expect(preview.summary.tv_total).toBe('50.00');
    expect(preview.summary.grand_total).toBe('400.00');
  });
});
