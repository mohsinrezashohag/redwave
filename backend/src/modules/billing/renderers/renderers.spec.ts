import { StatementExcelRenderer, StatementForExport } from './statement-excel.renderer';
import { InvoicePdfRenderer, InvoiceForExport } from './invoice-pdf.renderer';
import { QuickbooksCsvRenderer } from './quickbooks-csv.renderer';

const statement: StatementForExport = {
  statement_number: 7,
  client_name: 'Valley Fiber',
  client_code: 'VF',
  period_number: 3,
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  generated_at: '2026-02-01T00:00:00.000Z',
  currency: 'CAD',
  amount_cad: '145.00',
  lines: [
    { customer_name: 'Jane Doe', products_summary: 'Internet, TV', line_total: '85.00' },
    { customer_name: 'Bob Roe', products_summary: 'Internet', line_total: '60.00' },
  ],
  total_amount: '145.00',
};

const invoice: InvoiceForExport = {
  invoice_number: 4,
  client_name: 'Valley Fiber',
  client_code: 'VF',
  period_number: 3,
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  generated_at: '2026-02-01T00:00:00.000Z',
  currency: 'CAD',
  amount_cad: '145.00',
  total_commission: '145.00',
};

describe('StatementExcelRenderer', () => {
  it('produces a non-empty .xlsx (ZIP signature) — SRS BILL-002', async () => {
    const buf = await new StatementExcelRenderer().render(statement);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK'); // xlsx is a zip
  });
});

describe('InvoicePdfRenderer', () => {
  it('produces a non-empty PDF (%PDF header) — SRS BILL-003', async () => {
    const buf = await new InvoicePdfRenderer().render(invoice);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString('latin1')).toBe('%PDF');
  });
});

describe('QuickbooksCsvRenderer — QB-mappable, CAD, no tax, one row per customer', () => {
  const csv = new QuickbooksCsvRenderer().render(statement).toString('utf8');

  it('has a header + ONE row per customer line', () => {
    const rows = csv.trim().split('\n');
    expect(rows[0]).toContain('InvoiceNo'); // header
    expect(rows).toHaveLength(1 + statement.lines.length); // header + 2 customers
  });

  it('uses the statement number, the line amount, and labels currency CAD', () => {
    expect(csv).toContain('STMT-00007');
    expect(csv).toContain('Jane Doe');
    expect(csv).toContain('85.00');
    expect(csv).toContain('CAD');
  });

  it('carries NO tax/GST column (tax lives in QuickBooks)', () => {
    expect(csv.toLowerCase()).not.toMatch(/tax|gst|pst|vat/);
  });
});
