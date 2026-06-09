import { UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { StatementService } from './statement.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// A sale row as returned by the service's findMany select.
const sale = (
  id: string,
  customer: string,
  saleDate: string,
  items: { product_id: string; name: string }[],
) => ({
  id,
  customer_name: customer,
  sale_date: d(saleDate),
  sale_items: items.map((i) => ({ product_id: i.product_id, product: { name: i.name } })),
});

const rate = (productId: string, from: string, to: string | null, amount: string) => ({
  id: `r-${productId}-${from}`,
  product_id: productId,
  effective_from: d(from),
  effective_to: to ? d(to) : null,
  amount: { toString: () => amount },
});

function make(opts: {
  sales: ReturnType<typeof sale>[];
  rates: ReturnType<typeof rate>[];
  existingStatementId?: string | null;
}) {
  const tx = {
    clientStatement: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.existingStatementId ? { id: opts.existingStatementId } : null),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'stmt-x', lines: data.lines.create })),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'stmt-new', lines: data.lines.create })),
    },
    clientStatementLine: { deleteMany: jest.fn() },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', client_code: 'VF' }) },
    payPeriod: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'P1',
        period_number: 3,
        start_date: d('2026-01-01'),
        end_date: d('2026-01-31'),
      }),
    },
    sale: { findMany: jest.fn().mockResolvedValue(opts.sales) },
    clientBillingRate: { findMany: jest.fn().mockResolvedValue(opts.rates) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new StatementService(prisma as never, audit as never, { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never);
  return { service, prisma, tx, audit };
}

describe('StatementService.generate (SRS §12)', () => {
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
    const created = (tx.clientStatement.create.mock.calls[0][0] as { data: { total_amount: string; lines: { create: { line_total: string }[] } } }).data;
    expect(created.lines.create.map((l) => l.line_total)).toEqual(['50.00', '60.00']);
    expect(created.total_amount).toBe('110.00'); // exact Decimal, #10 effective-dating
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
    const created = (tx.clientStatement.create.mock.calls[0][0] as { data: { lines: { create: Record<string, unknown>[] } } }).data;
    expect(created.lines.create).toHaveLength(1);
    const line = created.lines.create[0];
    expect(line.products_summary).toBe('Internet, TV, Home Phone');
    expect(line.line_total).toBe('100.00');
    // No GST anywhere: the persisted shapes carry no tax/gst key.
    const keys = Object.keys(line).join(',') + ',' + Object.keys(created).join(',');
    expect(keys.toLowerCase()).not.toMatch(/tax|gst|pst|vat/);
  });

  it('a sold product with no effective billing rate → 422 (never silently under-bill)', async () => {
    const { service } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'no-rate', name: 'Internet' }])],
      rates: [],
    });
    await expect(service.generate('c1', 'P1', 'admin')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('regeneration replaces in place (deletes old lines, updates header — no duplicate)', async () => {
    const { service, tx } = make({
      sales: [sale('s1', 'Jane', '2026-01-10', [{ product_id: 'p', name: 'Internet' }])],
      rates: [rate('p', '2026-01-01', null, '60.00')],
      existingStatementId: 'stmt-existing',
    });
    await service.generate('c1', 'P1', 'admin');
    expect(tx.clientStatementLine.deleteMany).toHaveBeenCalledWith({
      where: { statement_id: 'stmt-existing' },
    });
    expect(tx.clientStatement.update).toHaveBeenCalled();
    expect(tx.clientStatement.create).not.toHaveBeenCalled();
  });

  it('excludes clawed-back items; a sale with no remaining items contributes no line', async () => {
    const { service, tx } = make({
      // sale_items already filtered by the service's where-clause; an empty items array models
      // "all items clawed back" → the sale should not produce a line.
      sales: [sale('s-empty', 'Gone', '2026-01-10', [])],
      rates: [],
    });
    await service.generate('c1', 'P1', 'admin');
    const created = (tx.clientStatement.create.mock.calls[0][0] as { data: { total_amount: string; lines: { create: unknown[] } } }).data;
    expect(created.lines.create).toHaveLength(0);
    expect(created.total_amount).toBe('0.00');
  });

  it('unknown client / period → 404', async () => {
    const { service, prisma } = make({ sales: [], rates: [] });
    prisma.client.findUnique.mockResolvedValueOnce(null);
    await expect(service.generate('nope', 'P1', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});
