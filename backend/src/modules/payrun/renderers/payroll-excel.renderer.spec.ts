/**
 * The payroll workbook heads its two split columns with the split itself ("0.7" / "0.3" in Redwave's file).
 * Since 2026-11-11 Redwave pays 100% / holds 0%, so the header must follow the run's REAL split — and a
 * header an admin renamed in Export Layouts must be left exactly as they set it.
 */
import * as ExcelJS from 'exceljs';
import { PayrollExcelRenderer, PayrollReportForExport } from './payroll-excel.renderer';

const LINE = {
  sale_id: 's1',
  sale_date: '2026-11-10',
  rep_external_code: 'Redwave20',
  rep_code: 'RW-1',
  rep_name: 'Sam Stone',
  customer_name: 'Tim',
  address: null,
  channel: 'VF',
  product_name: 'Fibre 1gig',
  has_internet: true,
  has_tv: false,
  has_home_phone: false,
  is_greenfield: false,
  internet_rate: '145.00',
  tv_rate: '0.00',
  hp_rate: '0.00',
  greenfield: '0.00',
  spiff: '0.00',
  other_total: '0.00',
  total_100: '145.00',
  advance_70: '145.00',
  holdback_30: '0.00',
};

const report = (over: Partial<PayrollReportForExport> = {}): PayrollReportForExport => ({
  pay_run_id: 'run-23',
  period_number: 23,
  period_start: '2026-11-08',
  period_end: '2026-11-21',
  run_status: 'finalized',
  generated_at: '2026-11-22T00:00:00.000Z',
  lines: [LINE],
  total_100: '145.00',
  advance_70: '145.00',
  holdback_30: '0.00',
  ...over,
});

async function headerRow(r: PayrollReportForExport): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await new PayrollExcelRenderer().render(r)) as never);
  const values = wb.worksheets[0].getRow(2).values as unknown[];
  return values.slice(1).map((v) => String(v));
}

describe('PayrollExcelRenderer — split column headers', () => {
  it('at 100/0 the split columns are headed "1" and "0", not "0.7" / "0.3"', async () => {
    const h = await headerRow(report({ split: { advance_pct: '1.0000', holdback_pct: '0.0000' } }));
    expect(h).toContain('1');
    expect(h).toContain('0');
    expect(h).not.toContain('0.7');
    expect(h).not.toContain('0.3');
  });

  it('a 70/30 run keeps Redwave’s "0.7" / "0.3" headers', async () => {
    const h = await headerRow(report({ split: { advance_pct: '0.7000', holdback_pct: '0.3000' } }));
    expect(h).toEqual(expect.arrayContaining(['0.7', '0.3']));
  });

  it('a header renamed in Export Layouts is left exactly as the admin set it', async () => {
    const layout = [
      { field: 'rep_name', header: 'Agent' },
      { field: 'total_100', header: 'Total' },
      { field: 'advance_70', header: 'Paid now' },
      { field: 'holdback_30', header: 'Held' },
    ];
    const h = await headerRow(report({ layout, split: { advance_pct: '1.0000', holdback_pct: '0.0000' } }));
    expect(h).toEqual(['Agent', 'Total', 'Paid now', 'Held']);
  });
});
