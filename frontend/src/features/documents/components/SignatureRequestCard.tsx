/**
 * SignatureRequestCard — one signature request with its per-signer status. Shows each signer (Avatar + name +
 * SignerStatusBadge + signed time + the per-signer signed-copy ref, read-only). The current user's Sign/
 * Decline appear ONLY when they are the asked PENDING signer in THIS request (row-level — the page computes
 * it; the server enforces). Cancel appears for the requester/owner/admin on a pending request. Tokens only.
 */
import { Avatar, Button, Card } from '../../../components/ui';
import { displayDate } from '../../../lib/format/date';
import { RequestStatusBadge, SignerStatusBadge } from './SignerStatusBadge';
import { DownloadLink } from './DownloadLink';
import { useSignatureFileUrl } from '../api/useDocumentFiles';
import styles from './documents.module.css';
import type { ResolvedUser } from '../api/useUserLookup';
import type { SignatureRequest } from '../documents.types';

/** A per-signer signed-copy download (fetches its own short-TTL signed URL). */
function SignedCopyLink({ signatureId }: { signatureId: string }) {
  const q = useSignatureFileUrl(signatureId);
  return <DownloadLink query={q} label="Signed copy" />;
}

interface Props {
  request: SignatureRequest;
  resolve: (userId: string) => ResolvedUser;
  isMyPendingRequest: boolean;
  canCancelThis: boolean;
  onSign: (decision: 'sign' | 'decline') => void;
  onCancel: () => void;
}

export function SignatureRequestCard({ request, resolve, isMyPendingRequest, canCancelThis, onSign, onCancel }: Props) {
  const requester = resolve(request.requested_by);
  return (
    <Card
      title={
        <span className={styles.requestHead}>
          <span>Signature request</span>
          <RequestStatusBadge status={request.status} />
        </span>
      }
    >
      <p className={styles.requestMeta}>
        Requested by {requester.label}
        {request.message ? ` · “${request.message}”` : ''}
        {request.due_date ? ` · due ${displayDate(request.due_date)}` : ''}
      </p>

      <div className={styles.signers}>
        {request.document_signatures.map((sig) => {
          const u = resolve(sig.recipient_user_id);
          return (
            <div key={sig.id} className={styles.signerRow}>
              <Avatar name={u.name} src={u.avatarUrl} size="sm" />
              <span className={styles.signerName}>{u.label}</span>
              {sig.signed_at && <span className={styles.signerTime}>{displayDate(sig.signed_at)}</span>}
              {sig.signed_file_url && <SignedCopyLink signatureId={sig.id} />}
              <SignerStatusBadge status={sig.status} />
            </div>
          );
        })}
      </div>

      {(isMyPendingRequest || canCancelThis) && (
        <div className={styles.requestActions}>
          {isMyPendingRequest && (
            <>
              <Button variant="primary" size="sm" onClick={() => onSign('sign')}>
                Sign
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onSign('decline')}>
                Decline
              </Button>
            </>
          )}
          {canCancelThis && (
            <Button variant="tertiary" size="sm" onClick={onCancel}>
              Cancel request
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
