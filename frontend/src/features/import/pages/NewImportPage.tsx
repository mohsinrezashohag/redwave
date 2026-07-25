/**
 * NewImportPage — /import/new. The STAGE step: pick a target, upload a real Excel/CSV file (+ client /
 * reconcile-total / an optional saved mapping), and stage. The backend parses + cleans + auto-suggests a
 * mapping + classifies — the UI does NO matching. On success → the batch detail (mapping + reconcile +
 * commit). `import:create`; 403 → AccessDenied; the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Card, Checkbox, FileUpload, FormField, MoneyInput, PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { usePreviewImport, useStageImport } from '../api/useImportMutations';
import { useImportMappings } from '../api/useImports';
import { StepIndicator } from '../components/StepIndicator';
import { PreviewPanel } from '../components/PreviewPanel';
import { KINDS } from '../import.types';
import styles from '../components/import.module.css';
import type { ImportKind, ImportPreview } from '../import.types';

const NO_MAPPING = '__auto__';

export default function NewImportPage() {
  const canCreate = useCan('import:create');
  const canViewClients = useCan('clients:view');
  const navigate = useNavigate();
  const onError = useApiErrorToast();
  const stage = useStageImport();
  const previewMutation = usePreviewImport();

  const [kind, setKind] = useState<ImportKind>('bulk_validation');
  const [clientId, setClientId] = useState<string | undefined>();
  const [reconcileTotal, setReconcileTotal] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mappingId, setMappingId] = useState<string>(NO_MAPPING);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheet, setSheet] = useState<string | undefined>();
  const [createMissing, setCreateMissing] = useState(false);

  const kindDef = useMemo(() => KINDS.find((k) => k.kind === kind)!, [kind]);
  const clientsQ = useClients('active', canCreate && canViewClients && kindDef.needsClient);
  const mappingsQ = useImportMappings(kindDef.source_type, canCreate);
  const mappings = (mappingsQ.data ?? []).filter((m) => m.source_type === kindDef.source_type);

  if (!canCreate) {
    return <AccessDenied message="Starting an import requires the import create permission." />;
  }

  /** Everything both the dry run and staging need — built once so they cannot drift apart. */
  const buildInput = (overrideSheet?: string) => ({
    file: file!,
    source_type: kindDef.source_type,
    import_type: kindDef.import_type,
    ...(kindDef.needsClient ? { client_id: clientId } : {}),
    ...(kindDef.needsReconcileTotal ? { reconcile_total: reconcileTotal.trim() } : {}),
    ...(mappingId !== NO_MAPPING ? { field_mapping_id: mappingId } : {}),
    ...(overrideSheet ?? sheet ? { sheet: overrideSheet ?? sheet } : {}),
    // Only ever sent for the migration target — the server rejects it anywhere else.
    ...(kind === 'historical_sales' && createMissing ? { create_missing: true } : {}),
  });

  /** Shared guards — a dry run needs the same inputs as staging. */
  const missingInput = (): string | null => {
    if (!file) return 'Choose an Excel or CSV file to upload.';
    if (kindDef.needsClient && !clientId) return 'Select a client for this import.';
    if (kindDef.needsReconcileTotal && !reconcileTotal.trim()) return 'A reconcile total is required for a balance migration.';
    return null;
  };

  const onPreview = (overrideSheet?: string) => {
    const problem = missingInput();
    if (problem) { setError(problem); return; }
    setError(null);
    previewMutation.mutate(buildInput(overrideSheet), {
      onSuccess: (result) => {
        setPreview(result);
        setSheet(result.sheet ?? undefined);
      },
      onError,
    });
  };

  const onStage = () => {
    const problem = missingInput();
    if (problem) { setError(problem); return; }
    setError(null);
    stage.mutate(buildInput(), { onSuccess: (batch) => navigate(`/import/${batch.id}`), onError });
  };

  /** Any change to the inputs invalidates the dry run — never show a preview of a different file. */
  const resetPreview = () => { setPreview(null); setSheet(undefined); };

  return (
    <div className={styles.page}>
      <PageHeader
        title="New import"
        subtitle="Upload a file, then review the mapping → reconcile → commit. The server parses, classifies, and applies; this screen never matches or commits rows itself."
        actions={<Button variant="tertiary" onClick={() => navigate('/import')}>Cancel</Button>}
      />
      <StepIndicator steps={[{ label: 'Upload', state: 'current' }, { label: 'Map + Reconcile', state: 'upcoming' }, { label: 'Commit', state: 'upcoming' }]} />

      <Card title="What to import">
        <div className={styles.form}>
          <FormField label="Import type" help={kindDef.description}>
            <Select options={KINDS.map((k) => ({ value: k.kind, label: k.label }))} value={kind} onValueChange={(v) => { setKind(v as ImportKind); setError(null); setMappingId(NO_MAPPING); resetPreview(); }} />
          </FormField>
          {kindDef.note && <Banner tone="info" title="Reference-only">{kindDef.note}</Banner>}
          {kindDef.needsClient && (
            <FormField label="Client" required help="The client whose report you're importing — its entered sales are matched by MPU ID.">
              {canViewClients ? (
                <Select placeholder="Select a client" options={(clientsQ.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` }))} value={clientId} onValueChange={setClientId} />
              ) : (
                <Banner tone="warning" title="Clients view required">Picking a client needs the clients view permission.</Banner>
              )}
            </FormField>
          )}
          {kindDef.needsReconcileTotal && (
            <FormField label="Reconcile total" required help="The source's total — the server verifies it matches the staged sum at commit (IMP-007).">
              <MoneyInput value={reconcileTotal} onChange={(e) => setReconcileTotal(e.target.value)} placeholder="0.00" />
            </FormField>
          )}
          {/* Migration-only: creating master data must never be possible on the live-sales path, where an
              invented rep or product would flow into the tier tally and the pay run. The server refuses it
              there too (422) — this just doesn't offer it. */}
          {kind === 'historical_sales' && (
            <FormField
              label="Create missing master data"
              help="Off by default. When on, a client / rep / product this file references but that doesn’t exist yet is created as a minimal placeholder — no billing rate, no money. Preview first to see exactly what would be created."
            >
              <Checkbox
                checked={createMissing}
                onCheckedChange={(v) => { setCreateMissing(v === true); resetPreview(); }}
                label="Create the referenced client / rep / product if it doesn’t exist"
              />
            </FormField>
          )}
          {mappings.length > 0 && (
            <FormField label="Saved mapping" help="Apply a saved column mapping, or let the server auto-suggest one from your headers.">
              <Select
                options={[{ value: NO_MAPPING, label: 'Auto-suggest from headers' }, ...mappings.map((m) => ({ value: m.id, label: m.name }))]}
                value={mappingId}
                onValueChange={(v) => { setMappingId(v); resetPreview(); }}
              />
            </FormField>
          )}
        </div>
      </Card>

      <Card title="File">
        <div className={styles.form}>
          <FileUpload
            accept=".xlsx,.xls,.csv,.tsv"
            multiple={false}
            hint="Excel (.xlsx/.xls) or CSV/TSV — up to 15 MB"
            onFiles={(f) => { setFile(f[0] ?? null); setError(null); resetPreview(); }}
          />
          <p className={styles.hint}>
            Need the format? Download a template from the import home. Column names are matched loosely, and a
            title row or an extra worksheet is fine — check the preview to confirm.
          </p>
          {error && <Banner tone="danger" title="Can’t continue yet">{error}</Banner>}
        </div>
      </Card>

      {preview && <PreviewPanel preview={preview} busy={previewMutation.isPending} onSheetChange={(s) => { setSheet(s); onPreview(s); }} />}

      <div className={styles.footer}>
        {/* Preview first: it runs the same server path as staging but writes nothing, so mapping problems
            surface before a batch exists. Staging stays available for a file the operator already trusts. */}
        <Button variant="secondary" loading={previewMutation.isPending} disabled={previewMutation.isPending || stage.isPending} onClick={() => onPreview()}>
          {preview ? 'Refresh preview' : 'Preview'}
        </Button>
        <Button variant="primary" loading={stage.isPending} disabled={stage.isPending || previewMutation.isPending} onClick={onStage}>
          Upload + stage
        </Button>
      </div>
    </div>
  );
}
