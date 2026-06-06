/**
 * Data Import types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/import/dto/import.response.ts`. The
 * backend stages + matches + gates + commits ATOMICALLY; this UI presents the staged rows and reconciles —
 * it does NO matching/commit logic. The `rows`/`mapped_data` swagger quirk is now fixed, so the REQUEST
 * bodies are typed from the generated schema too (no more hand-written bodies / casts).
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract.
export type ImportSourceType = components['schemas']['ImportBatchResponse']['source_type'];
export type ImportType = components['schemas']['ImportBatchResponse']['import_type'];
export type ImportBatchStatus = components['schemas']['ImportBatchResponse']['status'];
export type MatchStatus = components['schemas']['ImportRowResponse']['match_status'];
export type ReconcileAction = components['schemas']['RowResolution']['action'];

export type ImportRow = components['schemas']['ImportRowResponse'];

export type ImportBatch = components['schemas']['ImportBatchResponse'];

export interface ImportFilters {
  status?: ImportBatchStatus;
  source_type?: ImportSourceType;
  import_type?: ImportType;
}

// Request bodies — typed from the generated schema (the rows/mapped_data quirk is fixed in Batch A #2).
export type CreateImportBody = components['schemas']['CreateImportDto'];
export type RowResolutionBody = components['schemas']['RowResolution'];
export type ReconcileBody = components['schemas']['ReconcileDto'];

// ── The 3 supported kinds (friendly → pairing). The UI offers ONLY these, so an unsupported pairing can't be
//    staged from the screen. Each carries an editable JSON template for the rows editor. ──────────────────
export type ImportKind = 'bulk_validation' | 'billing_rate' | 'opening_holdback';

export interface KindDef {
  kind: ImportKind;
  label: string;
  description: string;
  source_type: ImportSourceType;
  import_type: ImportType;
  needsClient: boolean;
  needsReconcileTotal: boolean;
  template: Record<string, unknown>[];
  /** What the commit applies (shown in the commit confirm). */
  commitEffect: string;
}

export const KINDS: KindDef[] = [
  {
    kind: 'bulk_validation',
    label: 'Bulk sales validation (client report)',
    description: 'Match a client report to entered sales by MPU ID and validate the matched sales.',
    source_type: 'client_report',
    import_type: 'sales',
    needsClient: true,
    needsReconcileTotal: false,
    template: [{ mpu_id: 'MPU-001' }, { mpu_id: 'MPU-002' }],
    commitEffect: 'validates each matched sale (entered → validated), in one transaction',
  },
  {
    kind: 'billing_rate',
    label: 'Historical billing rates (migration)',
    description: 'Load back-dated client billing rates (the sanctioned migration path; bypasses the live back-date guard).',
    source_type: 'master_migration',
    import_type: 'clients',
    needsClient: false,
    needsReconcileTotal: false,
    template: [{ client_id: '<client-uuid>', rate_kind: 'product', product_id: '<product-uuid>', amount: '60.00', effective_from: '2025-01-01' }],
    commitEffect: 'writes each back-dated client billing rate, in one transaction',
  },
  {
    kind: 'opening_holdback',
    label: 'Opening holdback balances (migration)',
    description: 'Load opening 30% holdback balances for reps against a closed/paid period. Requires a reconcile total.',
    source_type: 'balance_migration',
    import_type: 'holdback',
    needsClient: false,
    needsReconcileTotal: true,
    template: [{ rep_id: '<rep-uuid>', origin_pay_period_id: '<closed-period-uuid>', amount_held: '993.00' }],
    commitEffect: 'writes each opening holdback ledger entry, in one transaction',
  },
];

export function kindOf(batch: { source_type: ImportSourceType; import_type: ImportType }): KindDef | undefined {
  return KINDS.find((k) => k.source_type === batch.source_type && k.import_type === batch.import_type);
}
