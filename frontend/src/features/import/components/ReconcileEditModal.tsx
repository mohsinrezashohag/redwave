/**
 * ReconcileEditModal — fix a staged row's mapped data, then ask the backend to re-classify it (reconcile
 * `edit`). The UI never re-classifies; it submits corrected data and the server re-runs the matcher. JSON is
 * parsed client-side before submit. Tokens only.
 */
import { useState } from 'react';
import { Banner, Button, Modal, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useReconcile } from '../api/useImportMutations';
import styles from './import.module.css';
import type { ImportRow } from '../import.types';

export function ReconcileEditModal({ batchId, row, onClose }: { batchId: string; row: ImportRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const reconcile = useReconcile();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The editor shows `seed` (the row's current data) until the user types; submit parses `text || seed`.
  const seed = row ? JSON.stringify(row.mapped_data ?? row.raw_data, null, 2) : '';

  const onSubmit = () => {
    if (!row) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || seed);
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('The row must be a JSON object.');
      return;
    }
    setError(null);
    reconcile.mutate(
      { id: batchId, body: { resolutions: [{ row_id: row.id, action: 'edit', mapped_data: parsed as Record<string, unknown> }] } },
      { onSuccess: () => { toast({ title: 'Row updated and re-checked', tone: 'success' }); setText(''); onClose(); }, onError },
    );
  };

  return (
    <Modal
      open={row !== null}
      onOpenChange={(o) => { if (!o && !reconcile.isPending) { setText(''); setError(null); onClose(); } }}
      title={row ? `Edit row ${row.row_number}` : 'Edit row'}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={reconcile.isPending}>Cancel</Button>
          <Button variant="primary" type="button" onClick={onSubmit} loading={reconcile.isPending} disabled={reconcile.isPending}>Save &amp; re-classify</Button>
        </div>
      }
    >
      {row && (
        <div className={styles.form}>
          <p className={styles.note}>Correct the row data; the server re-runs the matcher on save.</p>
          <Textarea className={styles.editorArea} value={text || seed} onChange={(e) => { setText(e.target.value); setError(null); }} maxHeight={320} rows={8} spellCheck={false} />
          {error && <p className={styles.editorError}>{error}</p>}
          <Banner tone="info" title="Re-classified server-side">Editing submits corrected data; the backend decides the new match status.</Banner>
        </div>
      )}
    </Modal>
  );
}
