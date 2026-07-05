/**
 * ReviewActions — Approve / Reject / Send-back for one submitted expense item (SRS EXP-006). CAD items
 * approve immediately; Reject/Send-back open a note dialog. A FOREIGN item (original_currency ≠ CAD, not yet
 * frozen) opens an FX dialog on Approve: the approver confirms/overrides the currency→CAD rate, which the
 * server FREEZES as amount_cad at approval (#12). The FE shows an approximate preview; the server is
 * authoritative. Used by the item detail page (the list uses the bulk bar, which can't carry an override).
 * Tokens only.
 */
import { useState } from 'react';
import { Banner, Button, FormField, Input, Modal, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { useReviewItem } from '../api/useExpenseMutations';
import type { ExpenseItem, ReviewDecision } from '../expenses.types';

const RATE = /^\d+(\.\d{1,8})?$/;

/** Approximate CAD preview (display-only; the server re-freezes exactly). */
function previewCad(amount: string, rate: string): string | null {
  if (!RATE.test(rate)) return null;
  const n = Number(amount) * Number(rate);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

export function ReviewActions({ item, onDone }: { item: ExpenseItem; onDone?: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const review = useReviewItem();
  const [noteFor, setNoteFor] = useState<null | 'reject' | 'send_back'>(null);
  const [note, setNote] = useState('');
  const [fxOpen, setFxOpen] = useState(false);
  const [fxRate, setFxRate] = useState('');

  // A foreign item that isn't converted yet must freeze an FX rate at approval (#12).
  const needsFx = item.original_currency !== 'CAD' && item.amount_cad == null;

  const decide = (decision: ReviewDecision, opts?: { note?: string; fx_rate?: string }) =>
    review.mutate(
      { id: item.id, body: { decision, note: opts?.note || undefined, fx_rate: opts?.fx_rate } },
      {
        onSuccess: () => {
          toast({
            title: decision === 'approve' ? 'Item approved' : decision === 'reject' ? 'Item rejected' : 'Sent back',
            tone: 'success',
          });
          setNoteFor(null);
          setNote('');
          setFxOpen(false);
          setFxRate('');
          onDone?.();
        },
        onError,
      },
    );

  const onApprove = () => (needsFx ? setFxOpen(true) : decide('approve'));
  const rateValid = RATE.test(fxRate);
  const rateError = fxRate !== '' && !rateValid ? 'Enter a rate with up to 8 decimal places' : undefined;
  const preview = previewCad(item.amount, fxRate);

  return (
    <>
      <Button variant="primary" onClick={onApprove} loading={review.isPending}>
        Approve
      </Button>
      <Button variant="secondary" onClick={() => setNoteFor('send_back')}>
        Send back
      </Button>
      <Button variant="destructive" onClick={() => setNoteFor('reject')}>
        Reject
      </Button>

      {/* Foreign-item approval: confirm/override the currency→CAD rate to freeze (#12). */}
      <Modal
        open={fxOpen}
        onOpenChange={(o) => {
          // Never dismiss mid-freeze (the mutation keeps running) — matches the disabled primary button.
          if (!o && !review.isPending) setFxOpen(false);
        }}
        title="Approve — confirm FX rate"
        footer={
          <>
            <Button variant="secondary" disabled={review.isPending} onClick={() => setFxOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={review.isPending} disabled={!rateValid} onClick={() => decide('approve', { fx_rate: fxRate })}>
              Approve &amp; freeze
            </Button>
          </>
        }
      >
        <Banner tone="info" title={`This expense is in ${item.original_currency}`}>
          Approving freezes the {item.original_currency}→CAD rate for{' '}
          <span className="mono">{money(item.amount, item.original_currency)}</span> and the converted CAD
          amount — it is never re-converted. Enter the rate if the FX source isn’t configured.
        </Banner>
        {review.isError && (
          <Banner tone="danger" title="Couldn’t approve">
            {review.error instanceof Error ? review.error.message : 'Please check the rate and try again.'}
          </Banner>
        )}
        <FormField
          label={`FX rate (${item.original_currency} → CAD)`}
          required
          error={rateError}
          help={preview ? `Freezes ≈ ${money(preview)} at this rate.` : 'Up to 8 decimal places.'}
        >
          <Input value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1.36500000" inputMode="decimal" className="mono" />
        </FormField>
      </Modal>

      <Modal
        open={noteFor !== null}
        onOpenChange={(o) => !o && setNoteFor(null)}
        title={noteFor === 'reject' ? 'Reject item' : 'Send back for correction'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button
              variant={noteFor === 'reject' ? 'destructive' : 'primary'}
              loading={review.isPending}
              onClick={() => noteFor && decide(noteFor, { note })}
            >
              {noteFor === 'reject' ? 'Reject' : 'Send back'}
            </Button>
          </>
        }
      >
        <FormField label="Reason" help="Optional — shown to the submitter.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What needs fixing?" />
        </FormField>
      </Modal>
    </>
  );
}
