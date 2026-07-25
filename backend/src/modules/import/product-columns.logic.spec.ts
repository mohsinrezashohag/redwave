/**
 * Column-per-product-type specs. The headers below are taken VERBATIM from Redwave's own working file
 * `docs/uat/Client billing report.xlsx`, which lists each product type as its own true/false column and has
 * no product-list cell at all.
 */
import { detectProductTypeColumns, resolveRowProductTypes } from './product-columns.logic';
import { buildProductTypeVocab } from './value-vocabulary.logic';

const VOCAB = buildProductTypeVocab([
  { key: 'internet', label: 'Internet' },
  { key: 'tv', label: 'TV' },
  { key: 'home_phone', label: 'Home Phone' },
  { key: 'greenfield_internet', label: 'Greenfield Internet' },
]);

/** The real header row (row 2 of the file, under a formulas row). Note the trailing spaces — they are real. */
const REAL_HEADERS = [
  'Sale Date',
  'Agent ID',
  'Agent  Name ',
  "Customer's First Name ",
  "Customer's Last Name ",
  'Address',
  'Channel',
  'Product',
  'Internet ',
  'TV',
  'Home Phone',
  'Internet Rate',
  'TV Rate ',
  'HP Rate ',
  'Bundle Bonus',
  'Total',
];

describe('detectProductTypeColumns', () => {
  it('finds the three flag columns in the real header row', () => {
    expect(detectProductTypeColumns(REAL_HEADERS, VOCAB)).toEqual([
      { column: 'Internet ', key: 'internet' },
      { column: 'TV', key: 'tv' },
      { column: 'Home Phone', key: 'home_phone' },
    ]);
  });

  // The whole reason detection is EXACT: a loose match would read the RATE columns as flags and start
  // treating a dollar amount as a yes/no.
  it('does NOT mistake "Internet Rate" / "TV Rate" / "HP Rate" for flag columns', () => {
    const columns = detectProductTypeColumns(REAL_HEADERS, VOCAB).map((c) => c.column);
    expect(columns).not.toContain('Internet Rate');
    expect(columns).not.toContain('TV Rate ');
    expect(columns).not.toContain('HP Rate ');
  });

  it('does not treat a generic "Product" column as a type', () => {
    expect(detectProductTypeColumns(['Product'], VOCAB)).toEqual([]);
  });

  it('skips a column already claimed by another system field', () => {
    const columns = detectProductTypeColumns(REAL_HEADERS, VOCAB, ['TV']).map((c) => c.key);
    expect(columns).toEqual(['internet', 'home_phone']);
  });

  it('keeps the first column when two headers name the same type', () => {
    expect(detectProductTypeColumns(['Internet', 'internet'], VOCAB)).toEqual([{ column: 'Internet', key: 'internet' }]);
  });

  it('finds nothing in a file that uses a single list column', () => {
    expect(detectProductTypeColumns(['Client code', 'Product type(s)', 'Sale date'], VOCAB)).toEqual([]);
  });
});

describe('resolveRowProductTypes', () => {
  const typeColumns = detectProductTypeColumns(REAL_HEADERS, VOCAB);

  it('reads an internet-only row from the flags', () => {
    const raw = { 'Internet ': true, TV: false, 'Home Phone': false };
    expect(resolveRowProductTypes(raw, null, typeColumns, VOCAB).keys).toEqual(['internet']);
  });

  it('reads a bundle row from the flags, in catalogue-column order', () => {
    const raw = { 'Internet ': true, TV: true, 'Home Phone': true };
    expect(resolveRowProductTypes(raw, null, typeColumns, VOCAB).keys).toEqual(['internet', 'tv', 'home_phone']);
  });

  it.each([['true'], ['TRUE'], ['Yes'], ['Y'], [1], ['1'], [true]])('treats %p as set', (flag) => {
    const raw = { 'Internet ': flag, TV: false, 'Home Phone': false };
    expect(resolveRowProductTypes(raw, null, typeColumns, VOCAB).keys).toEqual(['internet']);
  });

  it.each([['false'], ['FALSE'], ['No'], ['N'], [0], [''], [null]])('treats %p as not set', (flag) => {
    const raw = { 'Internet ': true, TV: flag, 'Home Phone': false };
    expect(resolveRowProductTypes(raw, null, typeColumns, VOCAB).keys).toEqual(['internet']);
  });

  // An explicit cell is the authoritative statement of what was sold; flags are the fallback.
  it('an explicit list cell WINS over the flag columns', () => {
    const raw = { 'Internet ': true, TV: true, 'Home Phone': true };
    expect(resolveRowProductTypes(raw, 'internet', typeColumns, VOCAB).keys).toEqual(['internet']);
  });

  // The real file's `Product` column holds a marketing name, so it resolves to nothing — the flags win.
  it('falls back to the flags when the explicit cell names no known type', () => {
    const raw = { 'Internet ': true, TV: false, 'Home Phone': false };
    const res = resolveRowProductTypes(raw, 'Fibre 1gig/2.5gig', typeColumns, VOCAB);
    expect(res.keys).toEqual(['internet']);
    expect(res.unknown).toEqual([]);
  });

  it('keeps the original problem when neither the cell nor the flags yield anything', () => {
    const raw = { 'Internet ': false, TV: false, 'Home Phone': false };
    const res = resolveRowProductTypes(raw, 'Fibre Optic', typeColumns, VOCAB);
    expect(res.keys).toEqual([]);
    expect(res.unknown).toEqual(['Fibre Optic']); // reported, not swallowed
  });

  it('a row with every flag false resolves to nothing (the classifier reports it)', () => {
    const raw = { 'Internet ': false, TV: false, 'Home Phone': false };
    expect(resolveRowProductTypes(raw, null, typeColumns, VOCAB).keys).toEqual([]);
  });

  it('behaves exactly as before when there are no flag columns', () => {
    expect(resolveRowProductTypes({}, 'internet,tv', [], VOCAB).keys).toEqual(['internet', 'tv']);
  });
});
