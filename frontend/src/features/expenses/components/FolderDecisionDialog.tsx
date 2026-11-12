/**
 * FolderDecisionDialog — confirm sending a whole folder back, or rejecting it, before it happens
 * (2026-11-12). Both used to fire on a single click with no note, while rejecting one item asked for both.
 * The optional note is recorded on every item, so the submitter sees why. Tokens only.
 */
import { useEffect, useState } from 'react';
import { ConfirmDialog, FormField, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useReviewReport } from '../api/useExpenseMutations';

export type FolderDecision = 'send_back' | 'reject';

const COPY: Record<FolderDecision, { title: string; description: string; confirm: string; done: string }> = {
  send_back: {
    title: 'Send the whole folder back?',
    description: 'Every item still awaiting review goes back to the submitter to fix and resubmit.',
    confirm: 'Send back',
    done: 'Folder returned',
  },
  reject: {
    title: 'Reject the whole folder?',
    description: 'Every item still awaiting review is rejected and will not be reimbursed.',
    confirm: 'Reject all',
    done: 'Folder rejected',
  },
};

export function FolderDecisionDialog({
  folderId,
  decision,
  onClose,
}: {
  folderId: string | null;
  decision: FolderDecision | null;
  onClose: () => void;
}) {
  const review = useReviewReport();
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const open = !!folderId && !!decision;
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  if (!decision) return null;
  const copy = COPY[decision];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirm}
      destructive={decision === 'reject'}
      loading={review.isPending}
      onConfirm={() =>
        review.mutate(
          { id: folderId!, body: { decision, ...(note.trim() ? { note: note.trim() } : {}) } },
          {
            onSuccess: () => {
              toast({ title: copy.done, tone: 'success' });
              onClose();
            },
            onError,
          },
        )
      }
    >
      <FormField label="Note" help="Optional. Shown to the submitter on each item.">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />
      </FormField>
    </ConfirmDialog>
  );
}
