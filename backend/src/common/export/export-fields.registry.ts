/**
 * Export field registry — what each report type may put in a column, and what it may NOT.
 *
 * PURE: no I/O, no Prisma, no clock. It is the analogue of the import target-field registry, and like that
 * one it is the single source of truth for the fields a configuration may reference.
 *
 * ⚠ THIS IS WHERE INVARIANT #3 IS ENFORCED, and it is enforced HERE rather than in the UI or the service
 * on purpose. A configurable layout is precisely the mechanism by which someone could quietly reunite the
 * two rate streams — "just add the client rate to the payroll export, it's only a report". The registry
 * makes that impossible to express: the payroll report offers no client-rate field, and the statement
 * offers no rep-pay field. A layout naming a field its report does not own is rejected before it is
 * stored. Packet 09 says it explicitly: "enforce the split in the registry itself, not in the UI."
 *
 * LOAD-BEARING COLUMNS. The server-rendered workbooks carry a live SUBTOTAL strip over an autofiltered
 * range, and those formulas reference columns POSITIONALLY. A field marked `required` cannot be removed
 * and the money block cannot be broken up, because doing so emits a workbook full of #REF!. Selection,
 * order and label are configurable; the layout engine is not.
 */

export type ReportType = 'payroll' | 'statement' | 'sales' | 'expenses';

export interface ExportField {
  key: string;
  /** The default column heading. A layout may rename it. */
  label: string;
  /** Money columns are the ones the SUBTOTAL strip sums — they must stay contiguous and present. */
  money?: boolean;
  /**
   * Presence flags the statement's strip COUNTIFs. Same positional constraint as money: the formula spans
   * a RANGE, so these must stay contiguous too. The payroll sheet has no COUNTIF, so its flags are free.
   */
  flag?: boolean;
  /**
   * Cannot be removed from a layout. Either the workbook's formulas depend on it, or the row would be
   * unidentifiable without it.
   */
  required?: boolean;
}

export interface ReportDefinition {
  label: string;
  /** True when a live formula strip constrains the layout (server-rendered Excel). */
  hasFormulaStrip: boolean;
  fields: ExportField[];
}

/**
 * PAYROLL — the REP-PAY stream. Note what is absent and must stay absent: `client_billed`,
 * `client_rate`, `margin`, or anything else from the billing stream (#3).
 */
const PAYROLL: ReportDefinition = {
  label: "Payroll report (Redwave's workbook)",
  hasFormulaStrip: true,
  fields: [
    { key: 'sale_date', label: 'Sale Date', required: true },
    { key: 'rep_external_code', label: 'Agent ID', required: true },
    { key: 'rep_name', label: 'Agent (Normalized)' },
    { key: 'customer_name', label: 'Customer', required: true },
    { key: 'address', label: 'Address' },
    { key: 'channel', label: 'Channel' },
    { key: 'product_name', label: 'Product' },
    { key: 'has_internet', label: 'Internet' },
    { key: 'has_tv', label: 'TV' },
    { key: 'has_home_phone', label: 'Home Phone' },
    { key: 'internet_rate', label: 'Internet Rate', money: true },
    { key: 'tv_rate', label: 'TV Rate', money: true },
    { key: 'hp_rate', label: 'HP Rate', money: true },
    { key: 'greenfield', label: 'Greenfield', money: true },
    { key: 'spiff', label: 'Spiff', money: true },
    { key: 'other_total', label: 'Other', money: true },
    { key: 'total_100', label: 'Total 100 %', money: true, required: true },
    { key: 'advance_70', label: '0.7', money: true, required: true },
    { key: 'holdback_30', label: '0.3', money: true, required: true },
  ],
};

/**
 * STATEMENT — the CLIENT-BILLING stream. Note what is absent and must stay absent: `rep_paid`,
 * `advance_70`, `holdback_30`, or anything else from the rep-pay stream (#3).
 */
const STATEMENT: ReportDefinition = {
  label: 'Client statement',
  hasFormulaStrip: true,
  fields: [
    { key: 'sale_date', label: 'Sale Date', required: true },
    { key: 'rep_external_code', label: 'Agent ID', required: true },
    { key: 'rep_name', label: 'Agent Name' },
    { key: 'customer_first_name', label: "Customer's First Name" },
    { key: 'customer_last_name', label: "Customer's Last Name" },
    { key: 'address', label: 'Address' },
    { key: 'channel', label: 'Channel' },
    { key: 'product_name', label: 'Product' },
    { key: 'has_internet', label: 'Internet', flag: true },
    { key: 'has_tv', label: 'TV', flag: true },
    { key: 'has_home_phone', label: 'Home Phone', flag: true },
    { key: 'internet_rate', label: 'Internet Rate', money: true },
    { key: 'tv_rate', label: 'TV Rate', money: true },
    { key: 'hp_rate', label: 'HP Rate', money: true },
    { key: 'bundle_bonus', label: 'Bundle Bonus', money: true },
    { key: 'spiff', label: 'Spiff', money: true },
    { key: 'other_total', label: 'Other', money: true },
    { key: 'line_total', label: 'Total', money: true, required: true },
  ],
};

/**
 * SALES — the client-bill-shaped sales export. Its money is the FROZEN COMMISSION snapshot (what the rep
 * earned), deliberately blank on an unpaid sale; it reads no client billing rate (#3).
 */
const SALES: ReportDefinition = {
  label: 'Sales export',
  hasFormulaStrip: false,
  fields: [
    { key: 'sale_code', label: 'Sale ID', required: true },
    { key: 'sale_date', label: 'Sale date', required: true },
    { key: 'rep_external_code', label: 'Agent ID' },
    { key: 'rep_name', label: 'Agent Name' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'channel', label: 'Channel' },
    { key: 'client_name', label: 'Client' },
    { key: 'product_name', label: 'Product' },
    { key: 'has_internet', label: 'Internet' },
    { key: 'has_tv', label: 'TV' },
    { key: 'has_home_phone', label: 'Home Phone' },
    { key: 'internet_rate', label: 'Internet rate', money: true },
    { key: 'tv_rate', label: 'TV rate', money: true },
    { key: 'hp_rate', label: 'HP rate', money: true },
    { key: 'other_total', label: 'Other', money: true },
    { key: 'total', label: 'Total', money: true },
    { key: 'is_greenfield', label: 'Greenfield' },
    { key: 'status', label: 'Status' },
  ],
};

const EXPENSES: ReportDefinition = {
  label: 'Expense export',
  hasFormulaStrip: false,
  fields: [
    { key: 'expense_date', label: 'Date', required: true },
    { key: 'rep_name', label: 'Rep' },
    { key: 'category', label: 'Category', required: true },
    { key: 'description', label: 'Description' },
    { key: 'client_code', label: 'Client' },
    { key: 'currency', label: 'Currency' },
    { key: 'amount', label: 'Amount', money: true, required: true },
    { key: 'amount_cad', label: 'Amount (CAD)', money: true },
    { key: 'status', label: 'Status' },
    { key: 'is_personal', label: 'Personal' },
  ],
};

export const EXPORT_REGISTRY: Record<ReportType, ReportDefinition> = {
  payroll: PAYROLL,
  statement: STATEMENT,
  sales: SALES,
  expenses: EXPENSES,
};

export const REPORT_TYPES: ReportType[] = ['payroll', 'statement', 'sales', 'expenses'];

export function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as string[]).includes(value);
}

export interface LayoutColumn {
  field: string;
  /** Optional rename; absent means the registry's default label. */
  header?: string;
}

/**
 * Validate a layout against its report's registry. Returns human-readable errors, empty when valid.
 *
 * Four rules, each protecting something specific:
 *   1. **Unknown field** — the field must belong to THIS report. This is the #3 boundary: naming
 *      `client_billed` on a payroll layout fails here, because the payroll registry does not contain it.
 *   2. **No duplicates** — a repeated column produces a workbook with two identical headings and a
 *      SUBTOTAL that double-counts.
 *   3. **Required fields present** — the formulas and the row's identity depend on them.
 *   4. **Money columns contiguous** — only where a formula strip exists. `SUBTOTAL` spans a RANGE, so
 *      interleaving a text column through the money block makes the strip sum a column of words.
 */
export function validateLayout(reportType: ReportType, columns: LayoutColumn[]): string[] {
  const def = EXPORT_REGISTRY[reportType];
  const errors: string[] = [];
  if (columns.length === 0) {
    return ['a layout must have at least one column'];
  }

  const byKey = new Map(def.fields.map((f) => [f.key, f]));
  const seen = new Set<string>();
  for (const c of columns) {
    if (!byKey.has(c.field)) {
      errors.push(
        `'${c.field}' is not a field of the ${def.label} — a layout can only use fields this report owns`,
      );
      continue;
    }
    if (seen.has(c.field)) {
      errors.push(`'${c.field}' appears more than once`);
    }
    seen.add(c.field);
  }

  for (const f of def.fields) {
    if (f.required && !seen.has(f.key)) {
      errors.push(`'${f.key}' (${f.label}) is required and cannot be removed`);
    }
  }

  if (def.hasFormulaStrip) {
    // Both strips span a RANGE, so both blocks must stay unbroken. A column wedged into either one makes
    // the formula cover the wrong cells — a workbook that looks right and totals wrong, which is worse
    // than one full of #REF! because nobody notices.
    const contiguous = (pick: (f: ExportField) => boolean, what: string, formula: string) => {
      const at = columns
        .map((c, i) => ({ i, hit: (() => { const f = byKey.get(c.field); return f ? pick(f) : false; })() }))
        .filter((x) => x.hit)
        .map((x) => x.i);
      if (at.length > 0 && at[at.length - 1] - at[0] + 1 !== at.length) {
        errors.push(
          `${what} columns must be contiguous — this workbook carries a live ${formula} strip over a ` +
            `range, so another column placed between them would make the totals cover the wrong cells`,
        );
      }
    };
    contiguous((f) => f.money === true, 'money', 'SUBTOTAL');
    contiguous((f) => f.flag === true, 'presence-flag', 'COUNTIF');
  }

  return errors;
}

/** The built-in default layout for a report — every field, in registry order. */
export function defaultLayout(reportType: ReportType): LayoutColumn[] {
  return EXPORT_REGISTRY[reportType].fields.map((f) => ({ field: f.key, header: f.label }));
}

/**
 * A SAMPLE row per report — the export analogue of an import template, so an admin can see the shape a
 * layout produces without generating real data.
 */
export function sampleRow(reportType: ReportType): Record<string, string> {
  const samples: Record<string, string> = {
    sale_date: '2026-03-02',
    expense_date: '2026-03-02',
    sale_code: '2026-03-02-VF',
    rep_external_code: 'Redwave11',
    rep_code: 'RW-D-0001',
    rep_name: 'Jordan Lee',
    customer_name: 'Tim',
    customer_first_name: 'Tim',
    customer_last_name: 'Brown',
    address: '12 Main St, Winnipeg, MB, R3C 1A1',
    channel: 'VF',
    client_code: 'VF',
    client_name: 'Valley Fiber',
    product_name: 'Fibre 1gig/2.5gig',
    category: 'meals',
    description: 'Lunch with client',
    currency: 'CAD',
    status: 'paid',
    has_internet: 'Yes',
    has_tv: 'Yes',
    has_home_phone: 'No',
    is_greenfield: 'No',
    is_personal: 'No',
  };
  const money: Record<string, string> = {
    internet_rate: '145.00',
    tv_rate: '30.00',
    hp_rate: '0.00',
    greenfield: '0.00',
    bundle_bonus: '0.00',
    spiff: '0.00',
    other_total: '0.00',
    total_100: '175.00',
    advance_70: '122.50',
    holdback_30: '52.50',
    line_total: '400.00',
    total: '175.00',
    amount: '42.50',
    amount_cad: '42.50',
  };
  const row: Record<string, string> = {};
  for (const f of EXPORT_REGISTRY[reportType].fields) {
    row[f.key] = samples[f.key] ?? money[f.key] ?? '';
  }
  return row;
}
