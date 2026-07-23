/**
 * Data Import types — RESPONSE shapes ALIASED to the generated OpenAPI schema. The backend now does a REAL
 * upload → parse → clean → auto-map → classify → stage, then the ATOMIC + idempotent commit; this UI uploads
 * a file, adjusts the suggested mapping, reconciles, and commits — it does NO matching/commit logic. — SRS §15
 */
import type { components } from '../../api/generated/schema';

export type ImportSourceType = components['schemas']['ImportBatchResponse']['source_type'];
export type ImportType = components['schemas']['ImportBatchResponse']['import_type'];
export type ImportBatchStatus = components['schemas']['ImportBatchResponse']['status'];
export type MatchStatus = components['schemas']['ImportRowResponse']['match_status'];
export type ReconcileAction = components['schemas']['RowResolution']['action'];

export type ImportRow = components['schemas']['ImportRowResponse'];
export type ImportBatch = components['schemas']['ImportBatchResponse'];
export type StagedImport = components['schemas']['StagedImportResponse'];
export type ImportFieldMapping = components['schemas']['ImportFieldMappingResponse'];

export interface ImportFilters {
  status?: ImportBatchStatus;
  source_type?: ImportSourceType;
  import_type?: ImportType;
}

// Request bodies.
export type RowResolutionBody = components['schemas']['RowResolution'];
export type ReconcileBody = components['schemas']['ReconcileDto'];
export type RemapBody = components['schemas']['RemapDto'];
export type CreateMappingBody = components['schemas']['CreateMappingDto'];

// ── The 8 supported targets (friendly → pairing). The UI offers ONLY these. ──────────────────────────────
export type ImportKind =
  | 'bulk_validation'
  | 'bulk_sales'
  | 'create_clients'
  | 'create_products'
  | 'billing_rate'
  | 'create_reps'
  | 'historical_sales'
  | 'opening_holdback';

export interface KindDef {
  kind: ImportKind;
  label: string;
  description: string;
  source_type: ImportSourceType;
  import_type: ImportType;
  needsClient: boolean;
  needsReconcileTotal: boolean;
  /** What the commit applies (shown in the commit confirm). */
  commitEffect: string;
  /** Optional caveat banner (e.g. historical = reference-only). */
  note?: string;
}

export const KINDS: KindDef[] = [
  {
    kind: 'bulk_validation',
    label: 'Bulk sales validation (client report)',
    description: 'Match a client report to entered sales by MPU ID and validate the matches.',
    source_type: 'client_report',
    import_type: 'sales',
    needsClient: true,
    needsReconcileTotal: false,
    commitEffect: 'validates each matched sale (entered → validated), in one transaction',
  },
  {
    kind: 'bulk_sales',
    label: 'Bulk sales entry (live)',
    description: 'Upload real sales from a spreadsheet — one row per sale, products comma-separated.',
    source_type: 'sales_entry',
    import_type: 'sales',
    needsClient: false, // the client is per-row (client_code)
    needsReconcileTotal: false,
    commitEffect: 'creates each sale (entered, or validated where the row says so), in one transaction',
    note: 'These are LIVE sales: unlike historical imports they DO count toward the tier tally, pay runs and clawbacks. Import clients, products and reps first — an unknown code is reported as an error, never created.',
  },
  {
    kind: 'create_clients',
    label: 'Clients (master data)',
    description: 'Create or update clients (partners) by code.',
    source_type: 'master_migration',
    import_type: 'clients',
    needsClient: false,
    needsReconcileTotal: false,
    commitEffect: 'creates/updates each client, in one transaction',
  },
  {
    kind: 'create_products',
    label: 'Products + billing rates (master data)',
    description: 'Create products for a client, with an optional inline client-billing rate.',
    source_type: 'master_migration',
    import_type: 'products',
    needsClient: false,
    needsReconcileTotal: false,
    commitEffect: 'creates each product (+ optional billing rate), in one transaction',
  },
  {
    kind: 'billing_rate',
    label: 'Historical billing rates (migration)',
    description: 'Load back-dated client billing rates (the sanctioned migration path; bypasses the live back-date guard).',
    source_type: 'master_migration',
    import_type: 'billing_rates',
    needsClient: false,
    needsReconcileTotal: false,
    commitEffect: 'writes each back-dated client billing rate, in one transaction',
  },
  {
    kind: 'create_reps',
    label: 'Reps (master data)',
    description: 'Create reps by code (codes are never reused, #11).',
    source_type: 'master_migration',
    import_type: 'reps',
    needsClient: false,
    needsReconcileTotal: false,
    commitEffect: 'creates each rep, in one transaction',
  },
  {
    kind: 'historical_sales',
    label: 'Historical sales (migration — reference only)',
    description: 'Load already-paid / migrated sales for the owner’s business reporting.',
    source_type: 'master_migration',
    import_type: 'sales',
    needsClient: false,
    needsReconcileTotal: false,
    commitEffect: 'writes each historical sale (status=historical), in one transaction',
    note: 'Historical sales are REFERENCE-ONLY: they appear in the business dashboard but NEVER pay out, and never count toward commission / tier / leaderboard / holdback. Import clients, products, and reps first.',
  },
  {
    kind: 'opening_holdback',
    label: 'Opening holdback balances (migration)',
    description: 'Load opening 30% holdback balances for reps against a closed/paid period. Requires a reconcile total.',
    source_type: 'balance_migration',
    import_type: 'holdback',
    needsClient: false,
    needsReconcileTotal: true,
    commitEffect: 'writes each opening holdback ledger entry, in one transaction',
  },
];

export function kindByValue(kind: ImportKind): KindDef {
  return KINDS.find((k) => k.kind === kind)!;
}

export function kindOf(batch: { source_type: ImportSourceType; import_type: ImportType }): KindDef | undefined {
  return KINDS.find((k) => k.source_type === batch.source_type && k.import_type === batch.import_type);
}
