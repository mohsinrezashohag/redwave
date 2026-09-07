/**
 * Export field registry — the #3 boundary, and the rules that keep a configured layout renderable.
 *
 * A configurable layout is exactly where the two rate streams could be quietly reunited: "just add the
 * client rate to the payroll export, it's only a report." The registry makes that unexpressible, and these
 * tests are what keep it that way. The packet's definition of done says it outright: "the payroll field
 * registry contains no client-rate field. Assert in a spec."
 *
 * Per §14 rule 10: if one of these fails, an invariant broke — fix the code, not the spec.
 */
import {
  EXPORT_REGISTRY,
  REPORT_TYPES,
  defaultLayout,
  isReportType,
  sampleRow,
  validateLayout,
} from './export-fields.registry';

describe('#3 — the two streams cannot meet in a layout', () => {
  // The DoD's own assertion.
  it('the PAYROLL registry contains no client-billing field', () => {
    const keys = EXPORT_REGISTRY.payroll.fields.map((f) => f.key);
    for (const forbidden of ['client_billed', 'client_rate', 'billing_rate', 'line_total', 'margin', 'bundle_bonus']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('the STATEMENT registry contains no rep-pay field', () => {
    const keys = EXPORT_REGISTRY.statement.fields.map((f) => f.key);
    for (const forbidden of ['rep_paid', 'advance_70', 'holdback_30', 'total_100', 'greenfield', 'margin']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  // The boundary enforced at write time, not merely by omission from a dropdown.
  it('REJECTS a payroll layout naming a client-billing field', () => {
    const errors = validateLayout('payroll', [
      { field: 'sale_date' },
      { field: 'rep_external_code' },
      { field: 'customer_name' },
      { field: 'line_total' }, // a statement field
      { field: 'total_100' },
      { field: 'advance_70' },
      { field: 'holdback_30' },
    ]);
    expect(errors.some((e) => e.includes('line_total'))).toBe(true);
  });

  it('REJECTS a statement layout naming a rep-pay field', () => {
    const errors = validateLayout('statement', [
      { field: 'sale_date' },
      { field: 'rep_external_code' },
      { field: 'advance_70' }, // a payroll field
      { field: 'line_total' },
    ]);
    expect(errors.some((e) => e.includes('advance_70'))).toBe(true);
  });
});

describe('a layout must stay renderable', () => {
  it('accepts the built-in default for every report type', () => {
    for (const type of REPORT_TYPES) {
      expect(validateLayout(type, defaultLayout(type))).toEqual([]);
    }
  });

  it('rejects an empty layout', () => {
    expect(validateLayout('sales', [])).toEqual(['a layout must have at least one column']);
  });

  it('rejects a duplicated column — it would double-count in the strip', () => {
    const layout = [...defaultLayout('payroll'), { field: 'total_100' }];
    expect(validateLayout('payroll', layout).some((e) => e.includes('more than once'))).toBe(true);
  });

  it('rejects removing a REQUIRED column the formulas depend on', () => {
    const layout = defaultLayout('payroll').filter((c) => c.field !== 'total_100');
    expect(validateLayout('payroll', layout).some((e) => e.includes('total_100'))).toBe(true);
  });

  it('allows removing an OPTIONAL column', () => {
    const layout = defaultLayout('payroll').filter((c) => c.field !== 'address');
    expect(validateLayout('payroll', layout)).toEqual([]);
  });

  it('allows reordering and renaming', () => {
    const layout = defaultLayout('payroll');
    const reordered = [layout[1], layout[0], ...layout.slice(2)].map((c) =>
      c.field === 'rep_external_code' ? { ...c, header: 'Rep Code' } : c,
    );
    expect(validateLayout('payroll', reordered)).toEqual([]);
  });

  /**
   * The load-bearing rule. SUBTOTAL spans a RANGE, so a text column dropped between two money columns
   * makes the strip sum the wrong cells — a workbook that looks right and totals wrong. Rejecting it with
   * a named error beats emitting one full of #REF! or, worse, plausible nonsense.
   */
  it('rejects a layout that breaks the money block on a workbook with a formula strip', () => {
    const layout = defaultLayout('payroll');
    const moneyStart = layout.findIndex((c) => c.field === 'internet_rate');
    const broken = [
      ...layout.slice(0, moneyStart + 1),
      { field: 'channel' }, // a text column wedged into the money block
      ...layout.slice(moneyStart + 1).filter((c) => c.field !== 'channel'),
    ];
    expect(validateLayout('payroll', broken).some((e) => e.includes('contiguous'))).toBe(true);
  });

  // The sales/expense exports are generated client-side with no formulas, so ordering is free.
  it('allows an interleaved money block where there is NO formula strip', () => {
    const layout = defaultLayout('sales');
    const moneyStart = layout.findIndex((c) => c.field === 'internet_rate');
    const interleaved = [
      ...layout.slice(0, moneyStart + 1),
      { field: 'status' },
      ...layout.slice(moneyStart + 1).filter((c) => c.field !== 'status'),
    ];
    expect(validateLayout('sales', interleaved)).toEqual([]);
  });
});

describe('report types and samples', () => {
  it('recognises only the four report types', () => {
    expect(isReportType('payroll')).toBe(true);
    expect(isReportType('margin')).toBe(false); // margin is Super-Admin-only and not a configurable export
  });

  it('produces a sample row covering every field of a report', () => {
    for (const type of REPORT_TYPES) {
      const row = sampleRow(type);
      for (const f of EXPORT_REGISTRY[type].fields) {
        expect(Object.keys(row)).toContain(f.key);
      }
    }
  });

  // Every report must remain configurable at all — a definition with no optional field would be a
  // "configurable" export nobody can change.
  it('every report has at least one optional field', () => {
    for (const type of REPORT_TYPES) {
      expect(EXPORT_REGISTRY[type].fields.some((f) => !f.required)).toBe(true);
    }
  });
});
