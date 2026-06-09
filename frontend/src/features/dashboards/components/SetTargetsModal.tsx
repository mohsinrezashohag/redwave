/**
 * SetTargetsModal — a manager/admin sets each roster rep's activation target for the period (count goal).
 * Requires hrm:edit (the server is the real gate). Only changed rows are PUT (fan-out); the dashboards
 * invalidate so target-vs-actual refreshes. Tokens only.
 */
import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useSetTarget } from '../api/useTargets';
import styles from '../dashboards.module.css';

export interface TargetRow {
  rep_id: string;
  rep_name: string;
  target_activations: number | null;
}

export function SetTargetsModal({
  open,
  onClose,
  periodId,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  periodId: string | null;
  rows: TargetRow[];
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const set = useSetTarget();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(Object.fromEntries(rows.map((r) => [r.rep_id, r.target_activations != null ? String(r.target_activations) : ''])));
  }, [rows]);

  const onSave = async () => {
    if (!periodId) return;
    const changes = rows.filter((r) => {
      const v = (draft[r.rep_id] ?? '').trim();
      return v !== '' && v !== String(r.target_activations ?? '');
    });
    setSaving(true);
    const results = await Promise.allSettled(
      changes.map((r) => set.mutateAsync({ rep_id: r.rep_id, pay_period_id: periodId, target_count: Number(draft[r.rep_id]) })),
    );
    setSaving(false);
    const failed = results.filter((x) => x.status === 'rejected').length;
    if (failed > 0) onError(new Error(`${failed} target(s) failed to save`));
    toast({ title: `Saved ${results.length - failed} target(s)`, tone: failed ? 'warning' : 'success' });
    onClose();
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Set roster targets">
      {!periodId ? (
        <p className="mono">No open pay period — load the schedule first.</p>
      ) : (
        <div className={styles.targetForm}>
          {rows.length === 0 && <p className="mono">No reps in your roster.</p>}
          {rows.map((r) => (
            <label key={r.rep_id} className={styles.targetRow}>
              <span className={styles.targetName}>{r.rep_name}</span>
              <Input
                type="number"
                min={0}
                value={draft[r.rep_id] ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, [r.rep_id]: e.target.value }))}
                aria-label={`Target activations for ${r.rep_name}`}
                placeholder="—"
              />
            </label>
          ))}
          <div className={styles.targetFooter}>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSave} loading={saving} disabled={rows.length === 0}>
              Save targets
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
