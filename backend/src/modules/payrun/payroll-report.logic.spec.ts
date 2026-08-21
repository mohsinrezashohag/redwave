/**
 * Payroll-report aggregation — the pure row/total assembly behind Redwave's own workbook.
 *
 * The fixture below is built from `docs/uat/Payroll report.xlsx` as parsed in `system-audit.md` §1.1: its
 * three data rows and its row-1 SUBTOTAL strip (375 / 262.50 / 112.50). Note what is NOT asserted —
 * per-row equality with their typed-in internet rate. Their sheet holds 125 in one row and a hard-coded
 * `=IF(...)` 145 in another, switched by hand; the system computes what they retype. Matching them
 * cell-for-cell would be asserting their manual bookkeeping, not our correctness.
 */
import { Decimal } from 'decimal.js';
import { buildPayrollReport, PayrollSaleInput } from './payroll-report.logic';

const d = (v: string) => new Decimal(v);
const SEVENTY = d('0.70');

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

  it('reproduces the row-1 SUBTOTAL strip: 375.00 / 262.50 / 112.50', () => {
    const report = buildPayrollReport(workbook, SEVENTY);
    expect(money(report.total_100)).toBe('375.00');
    expect(money(report.advance_70)).toBe('262.50');
    expect(money(report.holdback_30)).toBe('112.50');
  });

  it('each line totals its own components and splits 70/30', () => {
    const [a, b, c] = buildPayrollReport(workbook, SEVENTY).lines;
    expect([money(a.total_100), money(a.advance_70), money(a.holdback_30)]).toEqual(['125.00', '87.50', '37.50']);
    expect([money(b.total_100), money(b.advance_70), money(b.holdback_30)]).toEqual(['175.00', '122.50', '52.50']);
    expect([money(c.total_100), money(c.advance_70), money(c.holdback_30)]).toEqual(['75.00', '52.50', '22.50']);
  });

  it('the strip equals the sum of the printed lines, so the sheet is internally consistent', () => {
    const report = buildPayrollReport(workbook, SEVENTY);
    const summed = report.lines.reduce((acc, l) => acc.plus(l.total_100), new Decimal(0));
    expect(money(summed)).toBe(money(report.total_100));
  });
});

describe('buildPayrollReport — money rules', () => {
  // #1 — the split must never lose or invent a cent, whatever the total.
  it('advance + holdback === total exactly, for awkward amounts', () => {
    for (const amount of ['0.01', '0.05', '33.33', '99.99', '145.45', '1234.56']) {
      const [line] = buildPayrollReport([sale('s', '2026-03-02', { components: components({ internet: amount }) })], SEVENTY).lines;
      expect(money(line.advance_70.plus(line.holdback_30))).toBe(money(line.total_100));
    }
  });

  it('rounds the advance HALF-UP and derives the holdback as the remainder', () => {
    // 0.05 × 0.70 = 0.035 → 0.04 half-up, leaving 0.01.
    const [line] = buildPayrollReport([sale('s', '2026-03-02', { components: components({ internet: '0.05' }) })], SEVENTY).lines;
    expect(money(line.advance_70)).toBe('0.04');
    expect(money(line.holdback_30)).toBe('0.01');
  });

  it('a priced item with no column of its own lands in `other` and still reaches the total', () => {
    const [line] = buildPayrollReport(
      [sale('s', '2026-03-02', { components: components({ internet: '125', other: '40' }) })],
      SEVENTY,
    ).lines;
    expect(money(line.other_total)).toBe('40.00');
    expect(money(line.total_100)).toBe('165.00');
  });

  it('the spiff column is included in the total (an ADDITION to their sheet)', () => {
    const [line] = buildPayrollReport(
      [sale('s', '2026-03-02', { components: components({ internet: '125', spiff: '20' }) })],
      SEVENTY,
    ).lines;
    expect(money(line.spiff)).toBe('20.00');
    expect(money(line.total_100)).toBe('145.00');
  });

  // #9 — greenfield is flat-rated and out of the tally, so it is reported separately, never as internet.
  it('greenfield is its OWN column, not folded into internet', () => {
    const [line] = buildPayrollReport(
      [sale('s', '2026-03-02', { is_greenfield: true, components: components({ greenfield: '100' }) })],
      SEVENTY,
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
      [sale('s3', '2026-03-09'), sale('s1', '2026-03-02'), sale('s2', '2026-03-02')],
      SEVENTY,
    );
    expect(report.lines.map((l) => l.sale_id)).toEqual(['s1', 's2', 's3']);
    expect(report.lines.map((l) => l.sort_order)).toEqual([0, 1, 2]);
  });

  it('does not mutate the caller\'s array', () => {
    const input = [sale('s2', '2026-03-09'), sale('s1', '2026-03-02')];
    buildPayrollReport(input, SEVENTY);
    expect(input.map((s) => s.sale_id)).toEqual(['s2', 's1']);
  });

  // The Agent ID column is the PARTNER-facing code; rep_code is carried for our own tie-out.
  it('carries both agent codes, so the renderer can fall back without a second lookup', () => {
    const [line] = buildPayrollReport([sale('s', '2026-03-02', { rep_external_code: null })], SEVENTY).lines;
    expect(line.rep_external_code).toBeNull();
    expect(line.rep_code).toBe('RW-D-0001');
  });

  it('an empty run produces no lines and zero totals, not an error', () => {
    const report = buildPayrollReport([], SEVENTY);
    expect(report.lines).toEqual([]);
    expect(money(report.total_100)).toBe('0.00');
    expect(money(report.advance_70)).toBe('0.00');
  });
});
