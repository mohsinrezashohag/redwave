/**
 * MappingEditor — adjust + save the column→field mapping for a staged batch (IMP-002). The server already
 * auto-suggested a mapping at upload; this lets the operator fix mismatches: each system field → a Select of
 * the parsed source columns. "Apply" re-maps + re-classifies the stored rows (remap, no re-upload); "Save"
 * persists a reusable mapping for next time. The system fields come from the target template; the source
 * columns from the rows' raw_data keys.
 */
import { useMemo, useState } from 'react';
import { Button, Card, FormField, Input, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useRemap, useSaveMapping } from '../api/useImportMutations';
import { templateForKind } from '../templates';
import styles from './import.module.css';
import type { ImportBatch, KindDef } from '../import.types';

const NONE = '__none__';

/**
 * There is NO client-side guessing here, deliberately.
 *
 * This panel used to recompute its own mapping with a crude normalized-contains match that ignored the
 * target's field ALIASES entirely — while the copy told the operator "the server auto-suggested a mapping at
 * upload". So the screen showed a mapping the server had never applied (MPU ID → TV, Customer → Agent ID),
 * and pressing Apply would have committed that fiction over the server's correct one.
 *
 * The batch now carries `applied_mapping`, which is the mapping the rows were actually classified with.
 * Display exactly that.
 */

export function MappingEditor({ batch, kind }: { batch: ImportBatch; kind?: KindDef }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const remap = useRemap();
  const save = useSaveMapping();

  const fields = templateForKind(kind?.kind ?? '')?.fields ?? [];
  const sourceColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const r of (batch.import_rows ?? []).slice(0, 20)) {
      Object.keys((r.raw_data ?? {}) as Record<string, unknown>).forEach((k) => cols.add(k));
    }
    return [...cols];
  }, [batch.import_rows]);

  const [mapping, setMapping] = useState<Record<string, string>>(() => ({ ...(batch.applied_mapping ?? {}) }));
  const [mappingName, setMappingName] = useState('');

  if (fields.length === 0 || sourceColumns.length === 0) return null;

  const toBody = () => Object.fromEntries(Object.entries(mapping).filter(([, col]) => col && col !== NONE));

  const onApply = () =>
    remap.mutate(
      { id: batch.id, body: { mapping_json: toBody() } },
      { onSuccess: () => toast({ title: 'Mapping applied', tone: 'success' }), onError },
    );

  const onSave = () => {
    if (!mappingName.trim()) return;
    save.mutate(
      { name: mappingName.trim(), source_type: batch.source_type, client_id: batch.client_id ?? undefined, mapping_json: toBody() },
      { onSuccess: () => { toast({ title: 'Mapping saved', tone: 'success' }); setMappingName(''); }, onError },
    );
  };

  return (
    <Card title="Column mapping">
      <p className={styles.hint}>
        This is the mapping the server applied to these rows. Adjust any mismatch and Apply to re-classify —
        a field left “not mapped” is simply absent from every row.
      </p>
      <div className={styles.mapGrid}>
        {fields.map((fld) => (
          <FormField key={fld.field} label={`${fld.label}${fld.required ? ' *' : ''}`}>
            <Select
              options={[{ value: NONE, label: '— not mapped —' }, ...sourceColumns.map((c) => ({ value: c, label: c }))]}
              value={mapping[fld.field] ?? NONE}
              onValueChange={(v) => setMapping((m) => ({ ...m, [fld.field]: v }))}
            />
          </FormField>
        ))}
      </div>
      <div className={styles.mapActions}>
        <Button variant="primary" size="sm" loading={remap.isPending} onClick={onApply}>Apply mapping</Button>
        <Input value={mappingName} onChange={(e) => setMappingName(e.target.value)} placeholder="Save as… (e.g. RF Now monthly)" maxLength={120} />
        <Button variant="secondary" size="sm" loading={save.isPending} disabled={!mappingName.trim()} onClick={onSave}>Save mapping</Button>
      </div>
    </Card>
  );
}
