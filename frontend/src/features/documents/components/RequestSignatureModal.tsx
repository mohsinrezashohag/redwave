/**
 * RequestSignatureModal — the UNIFIED share + request-signature action (DOC-002). Picking recipients makes
 * the document visible to them AND asks each to sign (there is no share-without-signing). Optionally the
 * requester PLACES signature fields on the PDF (where/what each recipient signs, DOC-003). Needs
 * `users:view` to populate the picker (the detail returns raw ids); without it, a graceful note.
 */
import { useState } from 'react';
import { Banner, Button, DatePicker, FormField, Modal, MultiSelect, Switch, Textarea, useToast } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useUserLookup } from '../api/useUserLookup';
import { useRequestSignature } from '../api/useDocumentMutations';
import { FieldPlacer, type PlacedField } from './FieldPlacer';
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
  const [placing, setPlacing] = useState(false);
  const [fields, setFields] = useState<PlacedField[]>([]);

  const activeUsers = users.filter((u) => u.status === 'active' && u.id !== user?.id);
  const options = activeUsers.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }));
  const recipients = recipientIds.map((id) => {
    const u = activeUsers.find((x) => x.id === id);
    return { id, label: u?.full_name ?? id };
  });

  const reset = () => {
    setRecipientIds([]);
    setMessage('');
    setDueDate('');
    setPlacing(false);
    setFields([]);
  };

  const onSubmit = () => {
    if (recipientIds.length === 0) return;
    // Drop fields whose recipient was removed; strip the local key.
    const valid = fields.filter((f) => recipientIds.includes(f.recipient_user_id));
    const body = {
      recipient_user_ids: recipientIds,
      message: message.trim() || undefined,
      due_date: dueDate || undefined,
      fields: valid.length
        ? valid.map((f) => ({ type: f.type, recipient_user_id: f.recipient_user_id, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }))
        : undefined,
    };
    request.mutate(
      { documentId, body },
      {
        onSuccess: () => {
          toast({
            title: 'Signature request sent',
            description: `${recipientIds.length} recipient(s)${valid.length ? `, ${valid.length} field(s)` : ''}.`,
            tone: 'success',
          });
          reset();
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
      size={placing ? 'lg' : 'md'}
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

            {recipientIds.length > 0 && (
              <Switch label="Place signature fields on the document" checked={placing} onCheckedChange={(c) => setPlacing(c === true)} />
            )}
            {placing && recipientIds.length > 0 && (
              <FieldPlacer documentId={documentId} recipients={recipients} fields={fields} onChange={setFields} />
            )}
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
