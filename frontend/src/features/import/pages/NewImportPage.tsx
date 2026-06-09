/**
 * NewImportPage — /import/new. The STAGE step: pick a target, upload a real Excel/CSV file (+ client /
 * reconcile-total / an optional saved mapping), and stage. The backend parses + cleans + auto-suggests a
 * mapping + classifies — the UI does NO matching. On success → the batch detail (mapping + reconcile +
 * commit). `import:create`; 403 → AccessDenied; the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Card, FileUpload, FormField, MoneyInput, PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { useStageImport } from '../api/useImportMutations';
import { useImportMappings } from '../api/useImports';
import { StepIndicator } from '../components/StepIndicator';
import { KINDS } from '../import.types';
import styles from '../components/import.module.css';
import type { ImportKind } from '../import.types';

const NO_MAPPING = '__auto__';

export default function NewImportPage() {
  const canCreate = useCan('import:create');
  const canViewClients = useCan('clients:view');
  const navigate = useNavigate();
  const onError = useApiErrorToast();
  const stage = useStageImport();

  const [kind, setKind] = useState<ImportKind>('bulk_validation');
  const [clientId, setClientId] = useState<string | undefined>();
  const [reconcileTotal, setReconcileTotal] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mappingId, setMappingId] = useState<string>(NO_MAPPING);
  const [error, setError] = useState<string | null>(null);

  const kindDef = useMemo(() => KINDS.find((k) => k.kind === kind)!, [kind]);
  const clientsQ = useClients('active', canCreate && canViewClients && kindDef.needsClient);
  const mappingsQ = useImportMappings(kindDef.source_type, canCreate);
  const mappings = (mappingsQ.data ?? []).filter((m) => m.source_type === kindDef.source_type);

  if (!canCreate) {
    return <AccessDenied message="Starting an import requires the import create permission." />;
  }

  const onStage = () => {
    if (!file) { setError('Choose an Excel or CSV file to upload.'); return; }
    if (kindDef.needsClient && !clientId) { setError('Select a client for this import.'); return; }
    if (kindDef.needsReconcileTotal && !reconcileTotal.trim()) { setError('A reconcile total is required for a balance migration.'); return; }
    setError(null);
    stage.mutate(
      {
        file,
        source_type: kindDef.source_type,
        import_type: kindDef.import_type,
        ...(kindDef.needsClient ? { client_id: clientId } : {}),
        ...(kindDef.needsReconcileTotal ? { reconcile_total: reconcileTotal.trim() } : {}),
        ...(mappingId !== NO_MAPPING ? { field_mapping_id: mappingId } : {}),
      },
      { onSuccess: (batch) => navigate(`/import/${batch.id}`), onError },
    );
  };

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
            <Select options={KINDS.map((k) => ({ value: k.kind, label: k.label }))} value={kind} onValueChange={(v) => { setKind(v as ImportKind); setError(null); setMappingId(NO_MAPPING); }} />
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
          {mappings.length > 0 && (
            <FormField label="Saved mapping" help="Apply a saved column mapping, or let the server auto-suggest one from your headers.">
              <Select
                options={[{ value: NO_MAPPING, label: 'Auto-suggest from headers' }, ...mappings.map((m) => ({ value: m.id, label: m.name }))]}
                value={mappingId}
                onValueChange={setMappingId}
              />
            </FormField>
          )}
        </div>
      </Card>

      <Card title="File">
        <div className={styles.form}>
          <FileUpload accept=".xlsx,.xls,.csv,.tsv" multiple={false} hint="Excel (.xlsx/.xls) or CSV/TSV — up to 15 MB" onFiles={(f) => { setFile(f[0] ?? null); setError(null); }} />
          <p className={styles.hint}>Need the format? Download a template from the import home.</p>
          {error && <Banner tone="danger" title="Can’t stage yet">{error}</Banner>}
        </div>
      </Card>

      <div className={styles.footer}>
        <Button variant="primary" loading={stage.isPending} disabled={stage.isPending} onClick={onStage}>
          Upload + stage
        </Button>
      </div>
    </div>
  );
}
