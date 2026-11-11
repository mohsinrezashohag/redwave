/**
 * FinalizeConfirmModal — the deliberate, explained COMMIT. Finalizing is the money action: it's atomic +
 * idempotent SERVER-side (#8); this modal makes the user confirm and spells out exactly what it does. The
 * primary button is disabled while the call is in flight to prevent a double-submit; on success the run
 * becomes finalized + locked (the caller stops offering finalize — re-finalize is a backend no-op anyway).
 * payrun:approve-gated in the UI; the server is the real gate (§5).
 */
import { Banner, Button, Modal, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useFinalizeRun } from '../api/usePayRunMutations';
import styles from './payrun.module.css';
import type { SplitLabels } from '../split';

export function FinalizeConfirmModal({
  runId,
  open,
  onClose,
  labels,
}: {
  runId: string;
  open: boolean;
  onClose: () => void;
  labels: SplitLabels;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const finalize = useFinalizeRun();

  const onConfirm = () => {
    finalize.mutate(runId, {
      onSuccess: () => { toast({ title: 'Pay run finalized', tone: 'success' }); onClose(); },
      onError,
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !finalize.isPending && onClose()}
      title="Finalize pay run"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={finalize.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={onConfirm} loading={finalize.isPending} disabled={finalize.isPending}>
            Finalize pay run
          </Button>
        </div>
      }
    >
      <Banner tone="warning" title="This is the commit point and cannot be undone.">
        Finalizing runs once, atomically. On success the run is locked and read-only.
      </Banner>
      <p className={styles.note}>Finalizing will:</p>
      <ul className={styles.finalizeList}>
        <li>freeze each rep&rsquo;s commission snapshots (tier, rate and amount, which can’t change afterwards);</li>
        <li>mark this period&rsquo;s sales <strong>Paid</strong>;</li>
        <li>
          {labels.holdsNothing
            ? 'pay 100% now (nothing is held back) and release any prior holds due this period;'
            : `record the ${labels.heldPct}% holdback and release any prior holds due this period;`}
        </li>
        <li>apply approved expenses and pending clawbacks;</li>
        <li>compose each rep&rsquo;s net payout.</li>
      </ul>
    </Modal>
  );
}
