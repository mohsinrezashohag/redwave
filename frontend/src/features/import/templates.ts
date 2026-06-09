/**
 * Downloadable import templates — the exact expected columns, example rows, and a short data dictionary for
 * each target, so Redwave has the format and never hand-cleans blindly (their explicit ask). Mirrors the
 * backend target-field registry. Import is mapping-driven, so any real layout still works — these are
 * sensible starting points (the VF / RF / CTI client-report variants are reasonable defaults to refine from
 * a real file). Generated client-side via the Batch-1 exportRows (Excel + CSV). — SRS §15
 */
import { exportRows } from '../../lib/export/exportRows';

export interface TemplateField {
  field: string;
  label: string;
  example: string;
  example2: string;
  dict: string;
  required: boolean;
}

export interface TemplateDef {
  id: string;
  label: string;
  group: 'Master data' | 'Sales' | 'Balances' | 'Client reports';
  description: string;
  fields: TemplateField[];
}

const f = (field: string, label: string, example: string, example2: string, dict: string, required = false): TemplateField => ({
  field,
  label,
  example,
  example2,
  dict,
  required,
});

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'clients',
    label: 'Clients',
    group: 'Master data',
    description: 'Create or update clients (partners) by code.',
    fields: [
      f('client_code', 'Client code', 'VF', 'RF', 'Unique client/partner code (e.g. VF, RF, CTI).', true),
      f('name', 'Name', 'Valley Fiber', 'RF Now', 'Client display name.', true),
      f('market', 'Market', 'CA', 'CA', 'CA or US.', true),
      f('supplies_mpu_id', 'Supplies MPU ID', 'true', 'false', 'true if the client supplies an MPU ID per house (CTI/VF), else false (RF Now).'),
    ],
  },
  {
    id: 'products',
    label: 'Products + billing rates',
    group: 'Master data',
    description: 'Create products for a client, with an optional inline client-billing rate.',
    fields: [
      f('client_code', 'Client code', 'VF', 'VF', 'The client this product belongs to (by code).', true),
      f('name', 'Product name', 'Internet 1Gb', 'TV Basic', 'Product display name.', true),
      f('product_type', 'Product type', 'internet', 'tv', 'internet / tv / home_phone / greenfield_internet / a custom add-on key.', true),
      f('billing_amount', 'Billing amount', '60.00', '25.00', 'Optional inline CLIENT billing rate (the commission stream is separate).'),
      f('effective_from', 'Effective from', '2026-01-01', '2026-01-01', 'Effective date for the inline billing rate (YYYY-MM-DD).'),
    ],
  },
  {
    id: 'billing_rates',
    label: 'Historical billing rates',
    group: 'Master data',
    description: 'Back-dated client billing rates (the sanctioned migration path).',
    fields: [
      f('client_code', 'Client code', 'VF', 'VF', 'Client (by code).', true),
      f('rate_kind', 'Rate kind', 'product', 'product', "'product' (needs a product name) or an add-on kind.", true),
      f('product_name', 'Product name', 'Internet 1Gb', 'TV Basic', "Product name (required when rate_kind = 'product')."),
      f('amount', 'Amount', '55.00', '22.00', 'Billing amount (CAD, exact decimal).', true),
      f('effective_from', 'Effective from', '2025-01-01', '2025-06-01', 'Effective date (back-dating allowed via import only).', true),
      f('effective_to', 'Effective to', '2025-12-31', '', 'Optional end date (open-ended if blank).'),
    ],
  },
  {
    id: 'reps',
    label: 'Reps',
    group: 'Master data',
    description: 'Create reps by code (codes are never reused).',
    fields: [
      f('rep_code', 'Rep code', 'RW-D-0001', 'RW-D-0002', 'Unique rep code (never reused).', true),
      f('full_name', 'Full name', 'Riley Rivera', 'Sam Stone', 'Rep full name.', true),
      f('hire_date', 'Hire date', '2025-09-01', '2025-09-15', 'Hire date (YYYY-MM-DD).', true),
      f('field_manager_code', 'Manager code', 'RW-M-0001', '', 'Optional manager code (else the importing admin).'),
      f('status', 'Status', 'active', 'active', 'active / terminated (default active).'),
    ],
  },
  {
    id: 'historical_sales',
    label: 'Historical sales (migration)',
    group: 'Sales',
    description: 'Already-paid / migrated sales — reference-only (business reporting; never paid). Import clients, products, reps first.',
    fields: [
      f('client_code', 'Client code', 'VF', 'RF', 'Client (by code).', true),
      f('rep_code', 'Rep code', 'RW-D-0001', 'RW-D-0002', 'Rep (by code).', true),
      f('product_type', 'Product type', 'internet', 'tv', 'internet / tv / home_phone / greenfield_internet.', true),
      f('sale_date', 'Sale date', '2025-03-12', '2025-04-02', 'The sale date (YYYY-MM-DD).', true),
      f('activation_date', 'Activation date', '2025-03-20', '2025-04-10', 'Reference only.'),
      f('billed_amount', 'Billed amount', '60.00', '25.00', 'The historical BILLED amount (business reference; NOT rep commission).', true),
      f('customer_name', 'Customer', 'Jane Doe', 'John Roe', 'Customer/household name (reference).'),
      f('mpu_id', 'MPU ID', 'MPU-1042', '', 'Client identifier (reference).'),
      f('is_greenfield', 'Greenfield', 'false', 'false', 'true/false (reference flag).'),
    ],
  },
  {
    id: 'opening_holdback',
    label: 'Opening holdback balances',
    group: 'Balances',
    description: 'Opening 30% holdback per rep against a closed/paid origin period.',
    fields: [
      f('rep_code', 'Rep code', 'RW-D-0001', 'RW-D-0002', 'Rep (by code) holding the balance.', true),
      f('origin_pay_period_id', 'Origin period id', '<closed-period-uuid>', '<closed-period-uuid>', 'The CLOSED/paid origin pay-period id the 30% was held in.', true),
      f('amount_held', 'Amount held', '993.00', '450.00', 'Outstanding 30% holdback (CAD, exact decimal).', true),
    ],
  },
  // ── Client report variants (bulk validation; match on MPU). Sensible defaults — refine from a real file. ──
  {
    id: 'cti_report',
    label: 'CTI client report',
    group: 'Client reports',
    description: 'CTI supplies an MPU ID per house — matched to entered sales.',
    fields: [
      f('mpu_id', 'MPU ID', 'MPU-1042', 'MPU-1043', 'House/unit identifier (matched to a sale).', true),
      f('customer_name', 'Customer', 'Jane Doe', 'John Roe', 'Subscriber name (reference).'),
      f('activation_date', 'Activation date', '2026-02-14', '2026-02-15', 'Reference only.'),
    ],
  },
  {
    id: 'vf_report',
    label: 'Valley Fiber client report',
    group: 'Client reports',
    description: 'VF supplies an MPU ID — matched to entered sales.',
    fields: [
      f('mpu_id', 'MPU ID', 'VF-22001', 'VF-22002', 'House/unit identifier (matched to a sale).', true),
      f('customer_name', 'Customer', 'Jane Doe', 'John Roe', 'Subscriber name (reference).'),
      f('activation_date', 'Activation date', '2026-02-14', '2026-02-15', 'Reference only.'),
    ],
  },
  {
    id: 'rf_report',
    label: 'RF Now client report',
    group: 'Client reports',
    description: 'RF Now supplies NO MPU ID — match manually by customer (leave MPU blank).',
    fields: [
      f('customer_name', 'Customer', 'Jane Doe', 'John Roe', 'Subscriber name — used for manual matching.', true),
      f('service_address', 'Service address', '123 Main St', '5 Oak Ave', 'Address (reference for manual matching).'),
      f('activation_date', 'Activation date', '2026-02-14', '2026-02-15', 'Reference only.'),
    ],
  },
];

/** Map an import kind → the template whose fields define its system fields (for the mapping editor). */
export const KIND_TO_TEMPLATE: Record<string, string> = {
  bulk_validation: 'cti_report',
  create_clients: 'clients',
  create_products: 'products',
  billing_rate: 'billing_rates',
  create_reps: 'reps',
  historical_sales: 'historical_sales',
  opening_holdback: 'opening_holdback',
};

export const templateForKind = (kind: string): TemplateDef | undefined => TEMPLATES.find((t) => t.id === KIND_TO_TEMPLATE[kind]);

/** Download a template as Excel or CSV: header row (labels) + two example rows. */
export function downloadTemplate(def: TemplateDef, format: 'xlsx' | 'csv'): void {
  const rows = [
    Object.fromEntries(def.fields.map((fld) => [fld.field, fld.example])),
    Object.fromEntries(def.fields.map((fld) => [fld.field, fld.example2])),
  ];
  void exportRows({
    format,
    filename: `redwave-import-${def.id}-template`,
    columns: def.fields.map((fld) => ({ header: fld.label, value: (r: Record<string, string>) => r[fld.field] ?? '' })),
    rows,
  });
}
