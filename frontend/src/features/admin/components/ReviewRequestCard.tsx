/**
 * ReviewRequestCard — one pending profile-change request in the reviewer queue (design-system §10.6):
 * the subject, the changed fields shown CURRENT → PROPOSED side by side, and Approve / Reject. Approve
 * applies the change to the live user; Reject (with a confirm) discards it. Server re-checks routing on
 * both. Tokens only.
 */
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Button, Card, Modal, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { profileFieldLabel, profileFieldValue } from '../../../lib/format/profileFields';
import { useApproveRequest, useRejectRequest } from '../api/useProfileReview';
import type { ReviewRequest, ReviewSubject } from '../admin.types';
import styles from './ReviewRequestCard.module.css';

export function ReviewRequestCard({ request }: { request: ReviewRequest }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const [confirmReject, setConfirmReject] = useState(false);

  const changes = Object.entries(request.proposed_changes).filter(([, v]) => v !== undefined && v !== null);
  // Rep-only fields (contact email / address / sizes) live on the rep record — read their current value from
  // `subject.rep`, not the user, or the reviewer would see a misleading "—". The user's email is the LOGIN
  // email, so a requested `email` is always compared against the rep's contact email.
  const REP_KEYS = new Set(['email', 'address_street', 'address_city', 'address_province', 'address_postal', 'jacket_size', 'tshirt_size']);
  const currentValue = (key: string) => {
    const v = REP_KEYS.has(key)
      ? request.subject.rep?.[key as keyof NonNullable<ReviewSubject['rep']>]
      : request.subject[key as keyof ReviewSubject];
    return v ? String(v) : '—';
  };

  const doApprove = () =>
    approve.mutate(request.id, {
      onSuccess: () => toast({ title: 'Approved', description: 'The profile change was applied.', tone: 'success' }),
      onError,
    });

  const doReject = () =>
    reject.mutate(request.id, {
      onSuccess: () => {
        toast({ title: 'Rejected', description: 'No changes were made.', tone: 'success' });
        setConfirmReject(false);
      },
      onError,
    });

  return (
    <Card>
      <div className={styles.head}>
        <Avatar name={request.subject.full_name} src={request.subject.avatar_url} size="md" />
        <div className={styles.identity}>
          <span className={styles.name}>{request.subject.full_name}</span>
          <span className={styles.email}>{request.subject.email}</span>
        </div>
        <span className={styles.time}>Submitted {displayDate(request.created_at)}</span>
      </div>

      <div className={styles.diff}>
        {changes.map(([key, proposed]) => (
          <div key={key} className={styles.diffRow}>
            <span className={styles.field}>{profileFieldLabel(key)}</span>
            {key === 'avatar_url' ? (
              // The photo: current → proposed as pictures (the server sends a short-lived preview URL).
              <span className={styles.fromTo}>
                <Avatar name={request.subject.full_name} src={request.subject.avatar_url} size="md" />
                <ArrowRight size={14} aria-hidden className={styles.arrow} />
                {proposed ? (
                  <Avatar name={request.subject.full_name} src={request.proposed_avatar_preview} size="md" />
                ) : (
                  <span className={styles.to}>Removed</span>
                )}
              </span>
            ) : (
              <span className={styles.fromTo}>
                <span className={styles.from}>{currentValue(key)}</span>
                <ArrowRight size={14} aria-hidden className={styles.arrow} />
                <span className={styles.to}>{profileFieldValue(key, proposed)}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <Button variant="primary" onClick={doApprove} loading={approve.isPending}>
          Approve
        </Button>
        <Button variant="destructive" onClick={() => setConfirmReject(true)}>
          Reject
        </Button>
      </div>

      <Modal
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this change?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReject(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doReject} loading={reject.isPending}>
              Reject change
            </Button>
          </>
        }
      >
        The proposed changes to <strong>{request.subject.full_name}</strong>&rsquo;s profile will be discarded.
        Their profile stays as it is, and they&rsquo;ll be notified.
      </Modal>
    </Card>
  );
}
