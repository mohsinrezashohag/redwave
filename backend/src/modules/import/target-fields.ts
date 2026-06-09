/**
 * Target-field registry — the single source of truth for each import target's system fields: the field
 * key, its TYPE (drives cleaning), whether it's required, header ALIASES (drive mapping auto-suggestion),
 * an example value, and a one-line dictionary entry (drives the downloadable templates). Keyed by
 * `${source_type}:${import_type}`. Friendly CODES (client_code/rep_code/product_type) are resolved to ids
 * by the service before classification. — SRS §15 IMP-002/004/011
 */
import { FieldType } from './clean.logic';

export interface TargetField {
  field: string;
  type: FieldType;
  required: boolean;
  label: string;
  aliases: string[]; // lowercased header variants for fuzzy matching
  example: string;
  dict: string;
}

export const targetKey = (sourceType: string, importType: string): string => `${sourceType}:${importType}`;

export const TARGET_FIELDS: Record<string, TargetField[]> = {
  // ── Recurring client report → bulk sales validation (match on MPU). — SALE-007 ──
  'client_report:sales': [
    { field: 'mpu_id', type: 'text', required: false, label: 'MPU ID', aliases: ['mpu', 'mpu #', 'mpu id', 'mpu_id', 'house id', 'unit id'], example: 'MPU-1042', dict: 'Client house/unit identifier; matches an entered sale (CTI/VF supply it; RF Now does not — leave blank and match manually).' },
    { field: 'customer_name', type: 'text', required: false, label: 'Customer', aliases: ['customer', 'name', 'customer name', 'subscriber', 'account name'], example: 'Jane Doe', dict: 'Customer/household name (reference only; aids manual matching).' },
    { field: 'activation_date', type: 'date', required: false, label: 'Activation date', aliases: ['activation', 'activation date', 'activated', 'install date'], example: '2026-02-14', dict: 'Reference only — drives no logic (sale_date governs the period).' },
  ],

  // ── Go-live master data: clients ──
  'master_migration:clients': [
    { field: 'client_code', type: 'code', required: true, label: 'Client code', aliases: ['code', 'client code', 'client_code', 'partner code'], example: 'VF', dict: 'Unique client/partner code (UPPER-cased; e.g. VF, RF, CTI).' },
    { field: 'name', type: 'text', required: true, label: 'Name', aliases: ['name', 'client name', 'partner', 'partner name'], example: 'Valley Fiber', dict: 'Client display name.' },
    { field: 'market', type: 'text', required: true, label: 'Market', aliases: ['market', 'country', 'region'], example: 'CA', dict: 'Market: CA or US.' },
    { field: 'supplies_mpu_id', type: 'text', required: false, label: 'Supplies MPU ID', aliases: ['mpu', 'supplies mpu', 'has mpu', 'mpu id'], example: 'true', dict: 'true if the client supplies an MPU ID per house (CTI/VF), else false (RF Now).' },
  ],

  // ── Go-live master data: products (+ optional inline billing rate) ──
  'master_migration:products': [
    { field: 'client_code', type: 'code', required: true, label: 'Client code', aliases: ['code', 'client code', 'client'], example: 'VF', dict: 'The client this product belongs to (by code).' },
    { field: 'name', type: 'text', required: true, label: 'Product name', aliases: ['name', 'product', 'product name', 'service'], example: 'Internet 1Gb', dict: 'Product display name.' },
    { field: 'product_type', type: 'text', required: true, label: 'Product type', aliases: ['type', 'product type', 'product_type', 'category'], example: 'internet', dict: 'Catalogue key: internet / tv / home_phone / greenfield_internet / a custom add-on key.' },
    { field: 'billing_amount', type: 'money', required: false, label: 'Billing amount', aliases: ['amount', 'rate', 'billing', 'price', 'billing amount'], example: '60.00', dict: 'Optional inline CLIENT billing rate (creates a client_billing_rate; the COMMISSION stream is separate, #3).' },
    { field: 'effective_from', type: 'date', required: false, label: 'Effective from', aliases: ['effective', 'effective from', 'start', 'from'], example: '2026-01-01', dict: 'Effective date for the inline billing rate (back-dating allowed via import only, #10).' },
  ],

  // ── Back-dated client billing rates (standalone; the sanctioned #10 path) ──
  'master_migration:billing_rates': [
    { field: 'client_code', type: 'code', required: true, label: 'Client code', aliases: ['code', 'client code', 'client'], example: 'VF', dict: 'Client (by code).' },
    { field: 'rate_kind', type: 'text', required: true, label: 'Rate kind', aliases: ['kind', 'rate kind', 'rate_kind', 'type'], example: 'product', dict: "Rate kind: 'product' (needs a product name) or an add-on kind." },
    { field: 'product_name', type: 'text', required: false, label: 'Product name', aliases: ['product', 'product name', 'service'], example: 'Internet 1Gb', dict: "Product name (required when rate_kind = 'product')." },
    { field: 'amount', type: 'money', required: true, label: 'Amount', aliases: ['amount', 'rate', 'price', 'billing'], example: '60.00', dict: 'Billing amount (CAD, exact decimal).' },
    { field: 'effective_from', type: 'date', required: true, label: 'Effective from', aliases: ['effective', 'effective from', 'start', 'from'], example: '2025-01-01', dict: 'Effective date (back-dating allowed via import only).' },
    { field: 'effective_to', type: 'date', required: false, label: 'Effective to', aliases: ['effective to', 'end', 'to', 'until'], example: '2025-12-31', dict: 'Optional end date (open-ended if blank).' },
  ],

  // ── Go-live master data: reps ──
  'master_migration:reps': [
    { field: 'rep_code', type: 'code', required: true, label: 'Rep code', aliases: ['code', 'rep code', 'rep_code', 'distributor code', 'agent code'], example: 'RW-D-0001', dict: 'Unique rep code (never reused, #11).' },
    { field: 'full_name', type: 'text', required: true, label: 'Full name', aliases: ['name', 'full name', 'rep', 'distributor', 'agent'], example: 'Riley Rivera', dict: 'Rep full name.' },
    { field: 'hire_date', type: 'date', required: true, label: 'Hire date', aliases: ['hire', 'hire date', 'start date', 'joined'], example: '2025-09-01', dict: 'Hire date.' },
    { field: 'field_manager_code', type: 'code', required: false, label: 'Manager code', aliases: ['manager', 'field manager', 'manager code', 'reports to'], example: 'RW-M-0001', dict: 'Optional field-manager rep/user code (else the importing admin is used).' },
    { field: 'status', type: 'text', required: false, label: 'Status', aliases: ['status', 'active'], example: 'active', dict: 'active / terminated (default active).' },
  ],

  // ── Historical / already-paid sales (reference-only — NEVER paid, business-aggregation only) ──
  'master_migration:sales': [
    { field: 'client_code', type: 'code', required: true, label: 'Client code', aliases: ['code', 'client code', 'client', 'partner'], example: 'VF', dict: 'Client (by code).' },
    { field: 'rep_code', type: 'code', required: true, label: 'Rep code', aliases: ['rep', 'rep code', 'distributor', 'agent', 'agent code'], example: 'RW-D-0001', dict: 'Rep (by code).' },
    { field: 'product_type', type: 'text', required: true, label: 'Product type', aliases: ['type', 'product type', 'product', 'service'], example: 'internet', dict: 'Product type (internet / tv / home_phone / greenfield_internet).' },
    { field: 'sale_date', type: 'date', required: true, label: 'Sale date', aliases: ['date', 'sale date', 'sold', 'order date'], example: '2025-03-12', dict: 'The sale date (reference; historical sales never enter a pay period).' },
    { field: 'activation_date', type: 'date', required: false, label: 'Activation date', aliases: ['activation', 'activation date', 'activated', 'install date'], example: '2025-03-20', dict: 'Reference only.' },
    { field: 'billed_amount', type: 'money', required: true, label: 'Billed amount', aliases: ['amount', 'billed', 'billed amount', 'revenue', 'value'], example: '60.00', dict: 'The historical BILLED amount (business-aggregation reference; NOT rep commission, #3).' },
    { field: 'customer_name', type: 'text', required: false, label: 'Customer', aliases: ['customer', 'name', 'subscriber', 'household'], example: 'Jane Doe', dict: 'Customer/household name (reference).' },
    { field: 'mpu_id', type: 'text', required: false, label: 'MPU ID', aliases: ['mpu', 'mpu id', 'house id'], example: 'MPU-1042', dict: 'Client identifier (reference).' },
    { field: 'is_greenfield', type: 'text', required: false, label: 'Greenfield', aliases: ['greenfield', 'is greenfield', 'gf'], example: 'false', dict: 'true/false (reference flag).' },
  ],

  // ── Opening holdback balances (IMP-007; UUIDs — these reference existing system records) ──
  'balance_migration:holdback': [
    { field: 'rep_code', type: 'code', required: true, label: 'Rep code', aliases: ['rep', 'rep code', 'distributor', 'agent'], example: 'RW-D-0001', dict: 'Rep (by code) holding the balance.' },
    { field: 'origin_pay_period_id', type: 'text', required: true, label: 'Origin period id', aliases: ['period', 'origin', 'origin period', 'pay period', 'period id'], example: 'a1b2c3d4-…', dict: 'The CLOSED/paid origin pay-period id the 30% was held in.' },
    { field: 'amount_held', type: 'money', required: true, label: 'Amount held', aliases: ['amount', 'held', 'amount held', 'balance', 'holdback'], example: '993.00', dict: 'Outstanding 30% holdback amount (CAD, exact decimal).' },
  ],
};

/** The cleaning field-type map for a target (field → type), for `cleanMappedRow`. */
export function fieldTypesFor(sourceType: string, importType: string): Record<string, FieldType> {
  const fields = TARGET_FIELDS[targetKey(sourceType, importType)] ?? [];
  return Object.fromEntries(fields.map((f) => [f.field, f.type]));
}
