import { Decimal } from 'decimal.js';
import { buildStatement, SaleComponents, SaleInput, splitCustomerName } from './statement.logic';

const d = (v: string) => new Decimal(v);
const item = (id: string, name: string, rate: string | null) => ({
  product_id: id,
  product_name: name,
  rate: rate === null ? null : d(rate),
});

const components = (over: Partial<SaleComponents> = {}): SaleComponents => ({
  internet: d('0'),
  tv: d('0'),
  home_phone: d('0'),
  bundle: d('0'),
  spiff: d('0'),
  other: d('0'),
  ...over,
});

const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  sale_id: 's1',
  sale_date: '2026-06-29',
  rep_code: 'Redwave15',
  rep_name: 'Atikur Rahman',
  customer_name: 'Liam Tremblay',
  customer_first_name: 'Liam',
  customer_last_name: 'Tremblay',
  address: '452 Rue Saint-Paul, Montreal, QC, H2Y 2A6',
  channel: 'VF',
  product_name: 'Fibre 1gig/2.5gig',
  has_internet: true,
  has_tv: false,
  has_home_phone: false,
  components: components(),
  items: [item('p-int', 'Fibre 1gig/2.5gig', '350.00')],
  ...over,
});

describe('buildStatement — one row per sale, per-component — SRS BILL-001', () => {
  it('carries every component and totals them EXACTLY (the Total column reconciles against its own row)', () => {
    const result = buildStatement([
      sale({
        has_tv: true,
        has_home_phone: true,
        components: components({
          internet: d('350.00'),
          tv: d('50.00'),
          home_phone: d('50.00'),
          bundle: d('35.00'),
          spiff: d('30.00'),
        }),
      }),
    ]);

    const line = result.lines[0];
    expect(result.lines).toHaveLength(1); // never one row per product
    expect(line.internet_rate.toFixed(2)).toBe('350.00');
    expect(line.tv_rate.toFixed(2)).toBe('50.00');
    expect(line.hp_rate.toFixed(2)).toBe('50.00');
    expect(line.bundle_bonus.toFixed(2)).toBe('35.00');
    expect(line.spiff.toFixed(2)).toBe('30.00');
    expect(line.line_total.toFixed(2)).toBe('515.00');
    expect(result.total_amount.toFixed(2)).toBe('515.00');
  });

  it('line_total is the sum of the SIX components for every composition — no lost cent (#1)', () => {
    const compositions: Partial<SaleComponents>[] = [
      { internet: d('350') },
      { internet: d('280'), tv: d('100') },
      { internet: d('365'), home_phone: d('90'), spiff: d('30') },
      { internet: d('340'), tv: d('50'), home_phone: d('50'), bundle: d('35'), spiff: d('30'), other: d('50') },
      { internet: d('0.01'), tv: d('0.01'), home_phone: d('0.01'), bundle: d('0.01'), spiff: d('0.01'), other: d('0.01') },
      { other: d('50') }, // a priced add-on with no column of its own still bills
    ];
    for (const c of compositions) {
      const comp = components(c);
      const line = buildStatement([sale({ components: comp })]).lines[0];
      const expected = comp.internet
        .plus(comp.tv)
        .plus(comp.home_phone)
        .plus(comp.bundle)
        .plus(comp.spiff)
        .plus(comp.other);
      expect(line.line_total.toString()).toBe(expected.toString());
    }
  });

  it('total_amount is the exact sum of every line', () => {
    const result = buildStatement([
      sale({ sale_id: 's1', components: components({ internet: d('350.00') }) }),
      sale({ sale_id: 's2', components: components({ internet: d('280.00'), tv: d('100.00') }) }),
      sale({ sale_id: 's3', components: components({ internet: d('0.01'), spiff: d('0.01') }) }),
    ]);
    expect(result.lines.map((l) => l.sale_id)).toEqual(['s1', 's2', 's3']);
    expect(result.total_amount.toFixed(2)).toBe('730.02');
  });

  it('sort_order preserves the priced order so a re-render is byte-stable', () => {
    const result = buildStatement([sale({ sale_id: 'a' }), sale({ sale_id: 'b' }), sale({ sale_id: 'c' })]);
    expect(result.lines.map((l) => l.sort_order)).toEqual([0, 1, 2]);
  });

  it('falls back to splitting customer_name when the sale predates the first/last columns', () => {
    const line = buildStatement([
      sale({ customer_name: 'Chloe Bouchard', customer_first_name: null, customer_last_name: null }),
    ]).lines[0];
    expect(line.customer_first_name).toBe('Chloe');
    expect(line.customer_last_name).toBe('Bouchard');
  });

  it('prefers the stored first/last pair over splitting (a multi-word first name survives)', () => {
    const line = buildStatement([
      sale({ customer_name: 'Mary Anne Fischer', customer_first_name: 'Mary Anne', customer_last_name: 'Fischer' }),
    ]).lines[0];
    expect(line.customer_first_name).toBe('Mary Anne');
    expect(line.customer_last_name).toBe('Fischer');
  });

  it('products_summary de-duplicates repeated product names', () => {
    const line = buildStatement([
      sale({ items: [item('p1', 'Internet', '60.00'), item('p2', 'Internet', '60.00'), item('p3', 'TV', '25.00')] }),
    ]).lines[0];
    expect(line.products_summary).toBe('Internet, TV');
  });

  it('empty input → no lines, total 0', () => {
    const result = buildStatement([]);
    expect(result.lines).toHaveLength(0);
    expect(result.total_amount.toFixed(2)).toBe('0.00');
  });
});

describe('splitCustomerName (legacy fallback only)', () => {
  it('splits on the first space', () => {
    expect(splitCustomerName('Liam Tremblay')).toEqual({ first: 'Liam', last: 'Tremblay' });
  });

  it('keeps everything after the first token as the last name', () => {
    expect(splitCustomerName('Mary Anne Fischer')).toEqual({ first: 'Mary', last: 'Anne Fischer' });
  });

  it('a single word is the first name, last blank', () => {
    expect(splitCustomerName('Cher')).toEqual({ first: 'Cher', last: '' });
  });

  it('tolerates blank / extra whitespace', () => {
    expect(splitCustomerName('   ')).toEqual({ first: '', last: '' });
    expect(splitCustomerName('  Liam   Tremblay  ')).toEqual({ first: 'Liam', last: 'Tremblay' });
  });
});
