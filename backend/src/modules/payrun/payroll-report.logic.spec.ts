/**
 * Payroll-report aggregation — the pure row/total assembly behind Redwave's own workbook.
 *
 * The fixture below is built from `docs/uat/Payroll report.xlsx` as parsed in `system-audit.md` §1.1: its
 * three data rows and their total (375; no 70/30 split since 2026-11-13). Note what is NOT asserted —
 * per-row equality with their typed-in internet rate. Their sheet holds 125 in one row and a hard-coded
 * `=IF(...)` 145 in another, switched by hand; the system computes what they retype. Matching them
 * cell-for-cell would be asserting their manual bookkeeping, not our correctness.
 */
import { Decimal } from 'decimal.js';
import { buildPayrollReport, PayrollSaleInput } from './payroll-report.logic';

const d = (v: string) => new Decimal(v);

const components = (over: Partial<Record<string, string>> = {}) => ({
  internet: d(over.internet ?? '0'),
  tv: d(over.tv ?? '0'),
  home_phone: d(over.home_phone ?? '0'),
  greenfield: d(over.greenfield ?? '0'),
  spiff: d(over.spiff ?? '0'),
  other: d(over.other ?? '0'),
});

const sale = (
  id: string,
  saleDate: string,
  over: Partial<PayrollSaleInput> = {},
): PayrollSaleInput => ({
  sale_id: id,
  sale_date: saleDate,
  rep_external_code: 'Redwave11',
  rep_code: 'RW-D-0001',
  rep_name: 'Test Rep',
  customer_name: 'Tim',
  address: '12 Main St, Winnipeg, MB, R3C 1A1',
  channel: 'VF',
  product_name: 'Fibre 1gig/2.5gig',
  has_internet: true,
  has_tv: false,
  has_home_phone: false,
  is_greenfield: false,
  components: components(),
  ...over,
});

const money = (v: Decimal) => v.toFixed(2);

describe('buildPayrollReport — Redwave workbook fixture (system-audit §1.1)', () => {
  // Their three rows: 125 internet; 145 internet + 30 TV; 45 + 30 HP → 375 / 262.50 / 112.50.
  const workbook: PayrollSaleInput[] = [
    sale('s1', '2026-03-02', { components: components({ internet: '125' }) }),
    sale('s2', '2026-03-03', { has_tv: true, components: components({ internet: '145', tv: '30' }) }),
    sale('s3', '2026-03-04', { has_home_phone: true, components: components({ internet: '45', home_phone: '30' }) }),
  ];

  it('reproduces the row-1 SUBTOTAL: 375.00, paid in full', () => {
    const report = buildPayrollReport(workbook);
    expect(money(report.total_100)).toBe('375.00');
  });

  it('each line totals its own components', () => {
    const [a, b, c] = buildPayrollReport(workbook).lines;
    expect([money(a.total_100), money(b.total_100), money(c.total_100)]).toEqual(['125.00', '175.00', '75.00']);
  });

  it('the strip equals the sum of the printed lines, so the sheet is internally consistent', () => {
    const report = buildPayrollReport(workbook);
    const summed = report.lines.reduce((acc, l) => acc.plus(l.total_100), new Decimal(0));
    expect(money(summed)).toBe(money(report.total_100));
  });
});

describe('buildPayrollReport — money rules', () => {
  it('a priced item with no column of its own lands in `other` and still reaches the total', () => {
    const [line] = buildPayrollReport(
      [sale('s', '2026-03-02', { components: components({ internet: '125', other: '40' }) })]
    ).lines;
    expect(money(line.other_total)).toBe('40.00');
    expect(money(line.total_100)).toBe('165.00');
  });

  it('the spiff column is included in the total (an ADDITION to their sheet)', () => {
    const [line] = buildPayrollReport(
      [sale('s', '2026-03-02', { components: components({ internet: '125', spiff: '20' }) })]
    ).lines;
    expect(money(line.spiff)).toBe('20.00');
    expect(money(line.total_100)).toBe('145.00');
  });

  // #9 — greenfield is paid its own rate, so it is reported separately, never as internet.
  it('greenfield is its OWN column, not folded into internet', () => {
    const [line] = buildPayrollReport(
      [sale('s', '2026-03-02', { is_greenfield: true, components: components({ greenfield: '100' }) })]
    ).lines;
    expect(money(line.greenfield)).toBe('100.00');
    expect(money(line.internet_rate)).toBe('0.00');
    expect(money(line.total_100)).toBe('100.00');
    expect(line.is_greenfield).toBe(true);
  });
});

describe('buildPayrollReport — ordering and identity', () => {
  // A frozen line is re-rendered later; a stable order is what makes that reproducible (#2).
  it('orders by sale_date then sale_id, and numbers sort_order from zero', () => {
    const report = buildPayrollReport(
      [sale('s3', '2026-03-09'), sale('s1', '2026-03-02'), sale('s2', '2026-03-02')]
    );
    expect(report.lines.map((l) => l.sale_id)).toEqual(['s1', 's2', 's3']);
    expect(report.lines.map((l) => l.sort_order)).toEqual([0, 1, 2]);
  });

  it('does not mutate the caller\'s array', () => {
    const input = [sale('s2', '2026-03-09'), sale('s1', '2026-03-02')];
    buildPayrollReport(input);
    expect(input.map((s) => s.sale_id)).toEqual(['s2', 's1']);
  });

  // The Agent ID column is the PARTNER-facing code; rep_code is carried for our own tie-out.
  it('carries both agent codes, so the renderer can fall back without a second lookup', () => {
    const [line] = buildPayrollReport([sale('s', '2026-03-02', { rep_external_code: null })]).lines;
    expect(line.rep_external_code).toBeNull();
    expect(line.rep_code).toBe('RW-D-0001');
  });

  it('an empty run produces no lines and zero totals, not an error', () => {
    const report = buildPayrollReport([]);
    expect(report.lines).toEqual([]);
    expect(money(report.total_100)).toBe('0.00');
  });
});
