import * as ExcelJS from 'exceljs';
import { StatementExcelRenderer, StatementForExport, StatementLineForExport } from './statement-excel.renderer';
import { InvoicePdfRenderer, InvoiceForExport } from './invoice-pdf.renderer';
import { QuickbooksCsvRenderer } from './quickbooks-csv.renderer';
import { ExpenseDocForExport, ExpenseDocPdfRenderer } from './expense-doc-pdf.renderer';

const line = (over: Partial<StatementLineForExport> = {}): StatementLineForExport => ({
  sale_date: '2026-06-29',
  rep_code: 'Redwave15',
  rep_name: 'Atikur Rahman',
  customer_name: 'Jane Doe',
  customer_first_name: 'Jane',
  customer_last_name: 'Doe',
  address: '452 Rue Saint-Paul, Montreal, QC, H2Y 2A6',
  channel: 'VF',
  product_name: 'Fibre 1gig/2.5gig',
  has_internet: true,
  has_tv: true,
  has_home_phone: false,
  internet_rate: '350.00',
  tv_rate: '50.00',
  hp_rate: '0.00',
  bundle_bonus: '0.00',
  spiff: '30.00',
  other_total: '0.00',
  products_summary: 'Fibre 1gig/2.5gig, TV',
  line_total: '430.00',
  ...over,
});

const statement: StatementForExport = {
  statement_number: 7,
  client_name: 'Valley Fiber',
  client_code: 'VF',
  period_number: 27,
  period_start: '2026-06-29',
  period_end: '2026-07-05',
  is_billing_week: true,
  spiff_from: '2026-06-29',
  spiff_to: '2026-07-05',
  generated_at: '2026-07-06T00:00:00.000Z',
  currency: 'CAD',
  amount_cad: '810.00',
  lines: [
    line(),
    line({
      customer_name: 'Bob Roe',
      customer_first_name: 'Bob',
      customer_last_name: 'Roe',
      has_tv: false,
      tv_rate: '0.00',
      products_summary: 'Fibre 1gig/2.5gig',
      line_total: '380.00',
    }),
  ],
  total_amount: '810.00',
};

const invoice: InvoiceForExport = {
  invoice_number: 4,
  client_name: 'Valley Fiber',
  client_code: 'VF',
  period_number: 27,
  period_start: '2026-06-29',
  period_end: '2026-07-05',
  is_billing_week: true,
  generated_at: '2026-07-06T00:00:00.000Z',
  currency: 'CAD',
  amount_cad: '810.00',
  total_commission: '810.00',
};

/** Re-open a rendered workbook so the assertions read what the client will actually see. */
async function readBack(s: StatementForExport) {
  const buf = await new StatementExcelRenderer().render(s);
  const wb = new ExcelJS.Workbook();
  // exceljs types `load` against the DOM ArrayBuffer; the Node Buffer is accepted at runtime.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return { buf, ws: wb.worksheets[0] };
}

describe('StatementExcelRenderer — the client workbook format', () => {
  it('produces a non-empty .xlsx (ZIP signature) — SRS BILL-002', async () => {
    const { buf } = await readBack(statement);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK'); // xlsx is a zip
  });

  it('lays out the 17 target columns in order, with the header on row 2', async () => {
    const { ws } = await readBack(statement);
    const headers = (ws.getRow(2).values as (string | undefined)[]).slice(1).map((v) => String(v));
    expect(headers).toHaveLength(17); // no "Other" column — nothing to put in it
    expect(headers.slice(0, 11)).toEqual([
      'Sale Date',
      'Agent ID',
      'Agent Name',
      "Customer's First Name",
      "Customer's Last Name",
      'Address',
      'Channel',
      'Product',
      'Internet',
      'TV',
      'Home Phone',
    ]);
    expect(headers[11]).toContain('Internet Rate');
    expect(headers[12]).toContain('TV Rate');
    expect(headers[13]).toContain('HP Rate');
    expect(headers[14]).toContain('Bundle Bonus');
    expect(headers[15]).toContain('Spiff');
    expect(headers[16]).toContain('Total');
  });

  it('prints the applied spiff window in that column’s header', async () => {
    const { ws } = await readBack(statement);
    const spiffHeader = String(ws.getRow(2).getCell(16).value);
    expect(spiffHeader).toContain('Jun 29');
    expect(spiffHeader).toContain('Jul 5');
  });

  it('puts the summary strip ABOVE the header (row 1) as live COUNTIF / SUBTOTAL formulas', async () => {
    const { ws } = await readBack(statement);
    const formulaAt = (c: number) => (ws.getRow(1).getCell(c).value as { formula?: string } | null)?.formula;
    expect(formulaAt(9)).toBe('COUNTIF(I3:I4,TRUE)'); // Internet count
    expect(formulaAt(10)).toBe('COUNTIF(J3:J4,TRUE)'); // TV
    expect(formulaAt(11)).toBe('COUNTIF(K3:K4,TRUE)'); // Home Phone
    expect(formulaAt(12)).toBe('SUBTOTAL(9,L3:L4)'); // Internet Rate total
    expect(formulaAt(17)).toBe('SUBTOTAL(9,Q3:Q4)'); // grand total
  });

  it('autofilters header + data so the SUBTOTAL sums respect the client’s filtering', async () => {
    const { ws } = await readBack(statement);
    expect(ws.autoFilter).toBe('A2:Q4'); // header row 2 → last data row 4, across the 17 columns
  });

  it('writes real Date and Boolean cells so filtering and COUNTIF(…,TRUE) work', async () => {
    const { ws } = await readBack(statement);
    const first = ws.getRow(3);
    expect(first.getCell(1).value).toBeInstanceOf(Date);
    expect(first.getCell(9).value).toBe(true); // Internet
    expect(first.getCell(10).value).toBe(true); // TV
    expect(first.getCell(11).value).toBe(false); // Home Phone
    expect(first.getCell(17).value).toBe(430); // Total, as a number
  });

  it('adds an "Other" column ONLY when a row carries one (a priced add-on is never dropped)', async () => {
    const withOther = {
      ...statement,
      lines: [line({ other_total: '50.00', line_total: '480.00' })],
    };
    const { ws } = await readBack(withOther);
    const headers = (ws.getRow(2).values as (string | undefined)[]).slice(1).map((v) => String(v));
    expect(headers).toHaveLength(18);
    expect(headers[16]).toContain('Other');
    expect(headers[17]).toContain('Total');
    expect(ws.getRow(3).getCell(17).value).toBe(50); // the Other amount
  });

  it('renders an empty week without formulas over an empty range', async () => {
    const { ws } = await readBack({ ...statement, lines: [], total_amount: '0.00' });
    expect(ws.getRow(1).getCell(9).value).toBeNull();
    expect(String(ws.getRow(2).getCell(1).value)).toBe('Sale Date');
  });

  it('a legacy pay-period statement still renders (labelled Period, not Bill)', async () => {
    const legacy: StatementForExport = {
      ...statement,
      is_billing_week: false,
      period_number: 3,
      spiff_from: null,
      spiff_to: null,
      lines: [line({ sale_date: null, rep_code: null, rep_name: null, address: null, channel: null, product_name: null })],
    };
    const { ws } = await readBack(legacy);
    expect(String(ws.getRow(1).getCell(6).value)).toContain('Period 3');
  });
});

describe('InvoicePdfRenderer', () => {
  it('produces a non-empty PDF (%PDF header) — SRS BILL-003', async () => {
    const buf = await new InvoicePdfRenderer().render(invoice);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString('latin1')).toBe('%PDF');
  });
});

const expenseDoc: ExpenseDocForExport = {
  document_number: 1,
  client_name: 'CTI',
  client_code: 'CTI',
  period_number: 3,
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  generated_at: '2026-02-01T00:00:00.000Z',
  currency: 'USD',
  amount_cad: '136.50',
  total_amount: '100.00',
  lines: [
    { type: 'km', rep_name: 'Alice', date: '2026-01-10', description: '100.00 km', amount: '60.00' },
    { type: 'meals', rep_name: 'Alice', date: '2026-01-10', description: 'Dinner', amount: '40.00' },
  ],
};

describe('ExpenseDocPdfRenderer — km + food, grouped, no receipts (BILL-012)', () => {
  it('produces a non-empty PDF (%PDF header)', async () => {
    const buf = await new ExpenseDocPdfRenderer().render(expenseDoc);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('renders an empty document gracefully (no lines)', async () => {
    const buf = await new ExpenseDocPdfRenderer().render({ ...expenseDoc, lines: [], total_amount: '0.00' });
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
    expect(csv).toContain('430.00'); // the line total, not a component
    expect(csv).toContain('CAD');
  });

  it('carries NO tax/GST column (tax lives in QuickBooks)', () => {
    expect(csv.toLowerCase()).not.toMatch(/tax|gst|pst|vat/);
  });
});
