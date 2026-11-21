/**
 * FinalizeConfirmModal — "Mark as paid", the deliberate COMMIT of a commission report. It is the existing
 * finalize: atomic + idempotent SERVER-side (#8). It freezes each item's rep rate (#2), moves the sales from
 * validated to paid and writes the payroll lines. Built on ConfirmDialog with `requireTyped` (an irreversible
 * money action), and the confirm is disabled while the call is in flight. payrun:approve-gated in the UI;
 * the server is the real gate (§5). No clawback is deducted since 2026-11-16.
 */
import { ConfirmDialog, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useFinalizeRun } from '../api/usePayRunMutations';
import { MARK_PAID_PHRASE } from '../report.logic';
import styles from './payrun.module.css';

export function FinalizeConfirmModal({
  runId,
  label,
  open,
  onClose,
}: {
  runId: string;
  label: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const finalize = useFinalizeRun();

  const onConfirm = () => {
    if (finalize.isPending) return;
    finalize.mutate(runId, {
      onSuccess: () => {
        toast({ title: 'Report marked as paid', description: label, tone: 'success' });
        onClose();
      },
      onError,
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && !finalize.isPending && onClose()}
      title="Mark this report as paid?"
      description="This freezes the rates and cannot be undone."
      confirmLabel="Mark as paid"
      destructive={false}
      requireTyped={MARK_PAID_PHRASE}
      loading={finalize.isPending}
      onConfirm={onConfirm}
    >
      <p className={styles.note}>Marking as paid will:</p>
      <ul className={styles.finalizeList}>
        <li>freeze each sale item&rsquo;s rep rate and amount, so they can never change afterwards;</li>
        <li>move every sale in this report from Validated to <strong>Paid</strong>;</li>
        <li>record each rep&rsquo;s commission, approved expenses and bonus as paid in full.</li>
      </ul>
      <p className={styles.note}>
        A sale paid by another report in the meantime is never paid twice. If that happens you will be asked to
        refresh this report first.
      </p>
    </ConfirmDialog>
  );
}
