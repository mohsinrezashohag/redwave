/**
 * RequestSignatureModal — the UNIFIED share + request-signature action (DOC-002). Picking recipients makes
 * the document visible to them AND asks each to sign (there is no share-without-signing). Optionally the
 * requester PLACES signature fields on the PDF (where/what each recipient signs, DOC-003). Needs
 * `users:view` to populate the picker (the detail returns raw ids); without it, a graceful note.
 */
import { Send } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, ConfirmDialog, DatePicker, FormField, Modal, ModalClose, MultiSelect, Switch, Textarea, useToast } from '../../../components/ui';
import { recipientsWithoutSignature } from '../documents.logic';
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
  const [confirmMissing, setConfirmMissing] = useState(false);

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

  const validFields = fields.filter((f) => recipientIds.includes(f.recipient_user_id));
  // Fields were placed, but someone has no signature/initial box: they could "sign" without signing anything.
  const missing = placing ? recipientsWithoutSignature(recipientIds, validFields) : [];
  const missingNames = missing.map((id) => recipients.find((r) => r.id === id)?.label ?? id);

  const trySubmit = () => {
    if (missing.length > 0) setConfirmMissing(true);
    else onSubmit();
  };

  const onSubmit = () => {
    setConfirmMissing(false);
    if (recipientIds.length === 0) return;
    // Drop fields whose recipient was removed; strip the local key.
    const valid = placing ? validFields : [];
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
      onOpenChange={(o) => {
        if (!o && !request.isPending) {
          reset();
          onClose();
        }
      }}
      title="Request signatures"
      size={placing ? 'xl' : 'md'}
      dirty={recipientIds.length > 0 || fields.length > 0 || !!message.trim()}
      footer={
        <div className={styles.footer}>
          <ModalClose asChild>
            <Button variant="secondary" type="button" disabled={request.isPending}>
              Cancel
            </Button>
          </ModalClose>
          <Button leftIcon={<Send size={16} />} variant="primary" type="button" onClick={trySubmit} loading={request.isPending} disabled={request.isPending || recipientIds.length === 0 || !canViewUsers}>
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
            <FormField label="Message" help="Optional. Included in the notification.">
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please review and sign." maxLength={500} />
            </FormField>
            <FormField label="Due date" help="Optional. Recorded for reference only.">
              <DatePicker value={dueDate} min={todayIso()} onChange={setDueDate} aria-label="Due date" />
            </FormField>

            {recipientIds.length > 0 && (
              <Switch label="Place signature fields on the document" checked={placing} onCheckedChange={(c) => setPlacing(c === true)} />
            )}
            {placing && recipientIds.length > 0 && (
              <FieldPlacer documentId={documentId} recipients={recipients} fields={fields} onChange={setFields} />
            )}
            {missing.length > 0 && (
              <Banner tone="warning" title="Some recipients have no signature box">
                {missingNames.join(', ')} will be asked to sign, but no signature or initials box was placed for them.
              </Banner>
            )}
          </>
        ) : (
          <Banner tone="warning" title="User-list access required">
            Picking recipients needs the users view permission. Ask an administrator to send this request.
          </Banner>
        )}
      </div>
      <ConfirmDialog
        open={confirmMissing}
        onOpenChange={(o) => !o && setConfirmMissing(false)}
        title="Send without a signature box?"
        description={`${missingNames.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no signature or initials box on the document.`}
        confirmLabel="Send anyway"
        cancelLabel="Go back"
        destructive={false}
        onConfirm={onSubmit}
      />
    </Modal>
  );
}
