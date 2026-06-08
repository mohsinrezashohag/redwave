/**
 * RequestSignatureModal — the UNIFIED share + request-signature action (DOC-002). Picking recipients makes
 * the document visible to them AND asks each to sign (there is no share-without-signing). Needs `users:view`
 * to populate the picker (the detail returns raw ids); without it, a graceful note. Tokens only.
 */
import { useState } from 'react';
import { Banner, Button, DatePicker, FormField, Modal, MultiSelect, Textarea, useToast } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useUserLookup } from '../api/useUserLookup';
import { useRequestSignature } from '../api/useDocumentMutations';
import styles from './documents.module.css';

export function RequestSignatureModal({ open, onClose, documentId }: { open: boolean; onClose: () => void; documentId: string }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { user } = useAuth();
  const { users, canViewUsers } = useUserLookup();
  const request = useRequestSignature();
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');

  const options = users
    .filter((u) => u.status === 'active' && u.id !== user?.id)
    .map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }));

  const onSubmit = () => {
    if (recipientIds.length === 0) return;
    request.mutate(
      { documentId, body: { recipient_user_ids: recipientIds, message: message.trim() || undefined, due_date: dueDate || undefined } },
      {
        onSuccess: () => {
          toast({ title: 'Signature request sent', description: `${recipientIds.length} recipient(s) can now view and sign.`, tone: 'success' });
          setRecipientIds([]);
          setMessage('');
          setDueDate('');
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !request.isPending && onClose()}
      title="Request signatures"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={request.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={onSubmit} loading={request.isPending} disabled={request.isPending || recipientIds.length === 0 || !canViewUsers}>
            Send request
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <p className={styles.note}>Recipients can view the document and are asked to sign. Sharing and requesting a signature are the same action.</p>
        {canViewUsers ? (
          <>
            <FormField label="Recipients" required help="Each recipient is asked to sign.">
              <MultiSelect options={options} value={recipientIds} onChange={setRecipientIds} placeholder="Add recipients…" />
            </FormField>
            <FormField label="Message" help="Optional — included in the notification.">
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please review and sign." maxLength={500} />
            </FormField>
            <FormField label="Due date" help="Optional — recorded for reference only.">
              <DatePicker value={dueDate} min={todayIso()} onChange={setDueDate} aria-label="Due date" />
            </FormField>
          </>
        ) : (
          <Banner tone="warning" title="User-list access required">
            Picking recipients needs the users view permission. Ask an administrator to send this request.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
