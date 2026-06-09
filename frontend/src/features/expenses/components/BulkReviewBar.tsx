/**
 * BulkReviewBar — the bulk approve/reject/send-back control for selected expense items (SRS EXP-006).
 * Approve is immediate; Reject/Send-back open a note modal. One call to POST /v1/expense-items/bulk-review;
 * the server skips items not in a reviewable status (and out of scope) and returns the counts. Rendered
 * inside the DataTable's BulkActionBar. The server is the real gate. Tokens only.
 */
import { useState } from 'react';
import { Button, FormField, Modal, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useBulkReview } from '../api/useExpenseMutations';
import type { ReviewDecision } from '../expenses.types';

export function BulkReviewBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const bulk = useBulkReview();
  const [noteFor, setNoteFor] = useState<null | 'reject' | 'send_back'>(null);
  const [note, setNote] = useState('');

  const run = (decision: ReviewDecision, withNote?: string) =>
    bulk.mutate(
      { ids, decision, note: withNote || undefined },
      {
        onSuccess: (res) => {
          toast({
            title: `Reviewed ${res.reviewed} item(s)`,
            description: res.skipped ? `${res.skipped} skipped (not pending).` : undefined,
            tone: res.skipped ? 'warning' : 'success',
          });
          setNoteFor(null);
          setNote('');
          onDone();
        },
        onError,
      },
    );

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => run('approve')} loading={bulk.isPending}>
        Approve
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setNoteFor('send_back')}>
        Send back
      </Button>
      <Button variant="destructive" size="sm" onClick={() => setNoteFor('reject')}>
        Reject
      </Button>

      <Modal
        open={noteFor !== null}
        onOpenChange={(o) => !o && setNoteFor(null)}
        title={noteFor === 'reject' ? `Reject ${ids.length} item(s)` : `Send back ${ids.length} item(s)`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button
              variant={noteFor === 'reject' ? 'destructive' : 'primary'}
              loading={bulk.isPending}
              onClick={() => noteFor && run(noteFor, note)}
            >
              {noteFor === 'reject' ? 'Reject' : 'Send back'}
            </Button>
          </>
        }
      >
        <FormField label="Reason" help="Optional — shown to the submitters.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What needs fixing?" />
        </FormField>
      </Modal>
    </>
  );
}
