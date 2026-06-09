/**
 * DocumentDetailPage — /documents/:id. The document + its signature requests (per-signer status) + a composed
 * activity timeline + the SERVER-derived overall status (displayed, never recomputed). Actions are gated by
 * role/row: Request signatures (owner/admin + documents:create); Sign/Decline (ROW-LEVEL — only the asked
 * pending signer; the server enforces); Cancel (requester/owner/admin). A non-visible id → 404 → a graceful
 * not-found (NOT a permission error). §13.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileSignature } from 'lucide-react';
import { Banner, Button, Card, Modal, PageHeader, TableError, TableSkeleton, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useAuth } from '../../../auth/useAuth';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useDocument } from '../api/useDocuments';
import { useCancelRequest } from '../api/useDocumentMutations';
import { useCompletedFileUrl, useDocumentFileUrl } from '../api/useDocumentFiles';
import { useUserLookup } from '../api/useUserLookup';
import { canCancel, findMyPendingSignature, isNotFound } from '../documents.logic';
import { DocumentStatusBadge } from '../components/DocumentStatusBadge';
import { DocumentPreview } from '../components/DocumentPreview';
import { DownloadLink } from '../components/DownloadLink';
import { SignatureRequestCard } from '../components/SignatureRequestCard';
import { DocumentTimeline } from '../components/DocumentTimeline';
import { RequestSignatureModal } from '../components/RequestSignatureModal';
import { SignDeclineModal } from '../components/SignDeclineModal';
import { DOC_TYPE_LABELS } from '../documents.types';
import styles from '../components/documents.module.css';
import type { SignDecision, SignatureRequest } from '../documents.types';

/** The unsigned original — preview on demand (lazy pdf.js) + download. The original is never mutated. */
function OriginalDocumentCard({ documentId }: { documentId: string }) {
  const [show, setShow] = useState(false);
  const fileUrl = useDocumentFileUrl(documentId);
  return (
    <Card
      title={
        <span className={styles.previewHead}>
          <span>Original document</span>
          <span className={styles.downloadRow}>
            <Button variant="tertiary" size="sm" onClick={() => setShow((s) => !s)}>
              {show ? 'Hide preview' : 'Preview'}
            </Button>
            <DownloadLink query={fileUrl} label="Download" />
          </span>
        </span>
      }
    >
      {show ? <DocumentPreview query={fileUrl} /> : <p className={styles.note}>Preview the unsigned original in the browser, or download it.</p>}
    </Card>
  );
}

/** The final all-signatures copy (available once the request completes). */
function CompletedCopyRow({ documentId }: { documentId: string }) {
  const q = useCompletedFileUrl(documentId);
  return (
    <div className={styles.downloadRow}>
      <DownloadLink query={q} label="Download fully-signed copy" />
    </div>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canView = useCan('documents:view');
  const canCreate = useCan('documents:create');
  const { user, roles, isSuperAdmin } = useAuth();
  const isAdmin = isSuperAdmin || roles.includes('Admin');

  const q = useDocument(id, canView);
  const { resolve } = useUserLookup();
  const cancel = useCancelRequest();

  const [requestOpen, setRequestOpen] = useState(false);
  const [signTarget, setSignTarget] = useState<{ request: SignatureRequest; decision: SignDecision } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing documents requires the documents view permission." />;
  }
  if (q.isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Document" />
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }
  if (isNotFound(q.error)) {
    return (
      <div className={styles.page}>
        <PageHeader title="Document" actions={<Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate('/documents')}>Documents</Button>} />
        <Banner tone="warning" title="Not found">
          This document doesn’t exist or isn’t shared with you.
        </Banner>
      </div>
    );
  }
  const doc = q.data;
  if (q.isError || !doc) {
    return (
      <div className={styles.page}>
        <PageHeader title="Document" />
        <TableError message="Couldn’t load this document." onRetry={() => q.refetch()} />
      </div>
    );
  }

  const mySig = findMyPendingSignature(doc, user?.id);
  const isOwner = doc.owner_user_id === user?.id;
  const canRequest = canCreate && (isOwner || isAdmin);
  const requests = doc.signature_requests ?? [];

  const onConfirmCancel = () => {
    if (!cancelTarget) return;
    cancel.mutate(cancelTarget, {
      onSuccess: () => { toast({ title: 'Request cancelled', tone: 'success' }); setCancelTarget(null); },
      onError: (err) => { setCancelTarget(null); onError(err); },
    });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.detailHead}>
            {doc.title}
            <DocumentStatusBadge status={doc.status} />
          </span>
        }
        subtitle={`${DOC_TYPE_LABELS[doc.doc_type]} · owner ${resolve(doc.owner_user_id).label} · created ${displayDate(doc.created_at)}`}
        actions={
          <>
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate('/documents')}>
              Documents
            </Button>
            {canRequest && (
              <Button variant="primary" leftIcon={<FileSignature size={16} />} onClick={() => setRequestOpen(true)}>
                Request signatures
              </Button>
            )}
          </>
        }
      />

      <OriginalDocumentCard documentId={doc.id} />
      {doc.status === 'completed' && <CompletedCopyRow documentId={doc.id} />}

      {requests.length === 0 ? (
        <Banner tone="info" title="Not shared yet">
          This document is a draft. {canRequest ? 'Request signatures to share it and ask recipients to sign.' : 'It hasn’t been shared for signature.'}
        </Banner>
      ) : (
        requests.map((r) => (
          <SignatureRequestCard
            key={r.id}
            request={r}
            resolve={resolve}
            isMyPendingRequest={mySig?.requestId === r.id}
            canCancelThis={canCancel(r, doc, user?.id, isAdmin)}
            onSign={(decision) => setSignTarget({ request: r, decision })}
            onCancel={() => setCancelTarget(r.id)}
          />
        ))
      )}

      <Card title="Activity">
        <DocumentTimeline doc={doc} resolve={resolve} />
      </Card>

      <RequestSignatureModal open={requestOpen} onClose={() => setRequestOpen(false)} documentId={doc.id} />
      <SignDeclineModal
        open={signTarget !== null}
        onClose={() => setSignTarget(null)}
        documentId={doc.id}
        request={signTarget?.request ?? null}
        decision={signTarget?.decision ?? 'sign'}
      />

      <Modal
        open={cancelTarget !== null}
        onOpenChange={(o) => !o && !cancel.isPending && setCancelTarget(null)}
        title="Cancel signature request"
        footer={
          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={() => setCancelTarget(null)} disabled={cancel.isPending}>
              Keep request
            </Button>
            <Button variant="destructive" type="button" onClick={onConfirmCancel} loading={cancel.isPending} disabled={cancel.isPending}>
              Cancel request
            </Button>
          </div>
        }
      >
        <p className={styles.note}>Cancelling withdraws this signature request. If no other requests remain, the document returns to draft.</p>
      </Modal>
    </div>
  );
}
