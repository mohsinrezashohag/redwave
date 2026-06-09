/**
 * CommitConfirmModal — the high-stakes COMMIT confirm (import:approve). Commit is ATOMIC + IDEMPOTENT
 * SERVER-side (#8); this dialog requires a TYPED confirmation, explains the per-kind apply, and is
 * double-submit-safe. On success the batch is committed + locked; re-commit is a backend no-op so the caller
 * stops offering it. The server is the real gate — a 422 (still-unreconciled / holdback reconcile_total
 * mismatch) is surfaced via the error toast.
 */
import { Banner, ConfirmDialog, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCommit } from '../api/useImportMutations';
import styles from './import.module.css';
import type { KindDef } from '../import.types';

export function CommitConfirmModal({ batchId, kind, matchedCount, open, onClose }: { batchId: string; kind?: KindDef; matchedCount: number; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const commit = useCommit();

  const onConfirm = () => {
    commit.mutate(batchId, {
      onSuccess: () => { toast({ title: 'Import committed', tone: 'success' }); onClose(); },
      onError,
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && !commit.isPending && onClose()}
      title="Commit import"
      confirmLabel="Commit import"
      requireTyped="COMMIT"
      loading={commit.isPending}
      onConfirm={onConfirm}
    >
      <Banner tone="warning" title="This applies the batch atomically and cannot be undone.">
        All matched rows are applied in one transaction — if anything fails, the whole batch rolls back and stays staged.
      </Banner>
      <p className={styles.note}>
        Committing {kind ? <>{kind.commitEffect}</> : 'applies the matched rows'}. <strong>{matchedCount}</strong> matched row(s) will be applied; ignored rows are skipped. Type <span className="mono">COMMIT</span> to confirm.
      </p>
    </ConfirmDialog>
  );
}
