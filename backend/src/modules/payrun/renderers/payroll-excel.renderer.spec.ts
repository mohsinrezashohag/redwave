/**
 * The payroll workbook: one Total column (no tiers, no split since 2026-11-13); a header an admin renamed
 * stays exactly as they set it.
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
  ...over,
});

async function headerRow(r: PayrollReportForExport): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await new PayrollExcelRenderer().render(r)) as never);
  const values = wb.worksheets[0].getRow(2).values as unknown[];
  return values.slice(1).map((v) => String(v));
}

describe('PayrollExcelRenderer — one Total column (no split since 2026-11-13)', () => {
  it('the sheet ends at the Total column; there are no 70% / 30% columns', async () => {
    const h = await headerRow(report());
    expect(h[h.length - 1]).toBe('Total');
    expect(h).not.toContain('0.7');
    expect(h).not.toContain('0.3');
  });

  it('a header renamed in Export Layouts is left exactly as the admin set it', async () => {
    const h = await headerRow(report({ layout: [{ field: 'rep_name', header: 'Agent' }, { field: 'total_100', header: 'Paid' }] }));
    expect(h).toEqual(['Agent', 'Paid']);
  });
});
