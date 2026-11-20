/**
 * SignDocumentPage — /documents/:id/sign (optional ?request=<id>). The full-page signing view: a large,
 * responsive preview with the CURRENT user's fields highlighted and clickable, a sticky bar with progress,
 * "Next field" and "Finish", then a review step before the existing sign call.
 *
 * Row-level, like the old modal (§13.10): offered only when the user has a PENDING signature in a PENDING
 * request (findMyPendingSignature); the SERVER is the real gate (non-signer 403, closed 409). Statuses stay
 * server-derived. Date boxes show today's Winnipeg date for orientation only; the server stamps the real
 * signing date. The sign payload is exactly the one the modal sent. Decline is terminal and warned.
 * Signing outside the app (upload a signed PDF) is a visible secondary action. — SRS DOC-003/004
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Circle, PenLine, Save, Upload, XCircle } from 'lucide-react';
import {
  Banner,
  Button,
  ConfirmDialog,
  FileUpload,
  FormField,
  Input,
  Modal,
  ModalClose,
  PageHeader,
  TableError,
  TableSkeleton,
  useToast,
} from '../../../components/ui';
import { cx } from '../../../components/ui/cx';
import { RecordNotFound } from '../../../components/data/RecordNotFound';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { todayInWinnipeg } from '../../../lib/format/date';
import { useUnsavedChangesGuard } from '../../../lib/forms/useUnsavedChangesGuard';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useDocument } from '../api/useDocuments';
import { useDocumentFileUrl } from '../api/useDocumentFiles';
import { useSignRequest, useSignUpload } from '../api/useDocumentMutations';
import { fieldLabels, findMyPendingSignature, isNotFound, orderFields } from '../documents.logic';
import { DocumentPreview } from '../components/DocumentPreview';
import { DownloadLink } from '../components/DownloadLink';
import { SignatureCaptureDialog, type AdoptedSignature } from '../components/SignatureCaptureDialog';
import type { RenderedPage } from '../../../components/pdf/PdfDocumentView';
import styles from '../components/signing.module.css';
import docStyles from '../components/documents.module.css';
import type { Document, SignBody, SignatureField, SignatureRequest } from '../documents.types';

export default function SignDocumentPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const canView = useCan('documents:view');
  const { user } = useAuth();
  const q = useDocument(id, canView);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Signing documents requires the documents view permission." />;
  }
  if (q.isLoading) {
    return (
      <div className={docStyles.page}>
        <PageHeader title="Sign document" />
        <TableSkeleton rows={4} columns={2} />
      </div>
    );
  }
  if (isNotFound(q.error)) {
    return <RecordNotFound what="document" backTo="/documents" backLabel="Back to documents" />;
  }
  const doc = q.data;
  if (q.isError || !doc) {
    return (
      <div className={docStyles.page}>
        <PageHeader title="Sign document" />
        <TableError message="Couldn’t load this document." onRetry={() => q.refetch()} />
      </div>
    );
  }

  // Which request: the one in the link (if it is still mine to sign), else my first pending one.
  const wanted = params.get('request');
  const isMine = (r: SignatureRequest) =>
    r.status === 'pending' && r.document_signatures.some((s) => s.recipient_user_id === user?.id && s.status === 'pending');
  const fromLink = wanted ? (doc.signature_requests ?? []).find((r) => r.id === wanted && isMine(r)) : undefined;
  const mine = findMyPendingSignature(doc, user?.id);
  const request = fromLink ?? (doc.signature_requests ?? []).find((r) => r.id === mine?.requestId);

  if (!request) {
    return (
      <div className={docStyles.page}>
        <PageHeader
          title={doc.title}
          actions={
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate(`/documents/${doc.id}`)}>
              Back to document
            </Button>
          }
        />
        <Banner tone="info" title="Nothing to sign">
          You have no pending signature on this document. It may already be signed, declined or cancelled.
        </Banner>
      </div>
    );
  }

  return <SigningWorkspace key={request.id} doc={doc} request={request} userId={user?.id} />;
}

/** Round the measured width to steps so the PDF isn't re-rendered on every pixel of a resize. */
function usePaneWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth / 40) * 40);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const isImageField = (f: SignatureField) => f.type === 'signature' || f.type === 'initial';

function SigningWorkspace({ doc, request, userId }: { doc: Document; request: SignatureRequest; userId: string | undefined }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const sign = useSignRequest();
  const signUpload = useSignUpload();
  const fileUrl = useDocumentFileUrl(doc.id);
  const today = todayInWinnipeg();

  const myFields = useMemo(
    () => orderFields((request.signature_fields ?? []).filter((f) => f.recipient_user_id === userId)),
    [request.signature_fields, userId],
  );
  const labels = useMemo(() => fieldLabels(myFields), [myFields]);
  const needsImage = myFields.some(isImageField);
  const textFields = myFields.filter((f) => f.type === 'text');

  const [adopted, setAdopted] = useState<AdoptedSignature | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [captureFor, setCaptureFor] = useState<string | 'change' | null>(null);
  const [textEdit, setTextEdit] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const pane = useRef<HTMLDivElement>(null);
  const paneWidth = usePaneWidth(pane);

  const isDone = (f: SignatureField): boolean => {
    if (f.type === 'date') return true;
    if (f.type === 'text') return !!(textValues[f.id] ?? '').trim();
    return !!adopted && applied.has(f.id);
  };
  const doneCount = myFields.filter(isDone).length;
  const total = myFields.length;
  const imagesDone = myFields.filter(isImageField).every((f) => !!adopted && applied.has(f.id));
  const blankText = textFields.filter((f) => !(textValues[f.id] ?? '').trim());
  const dirty = !!adopted || applied.size > 0 || Object.values(textValues).some((v) => v.trim());
  const leave = useUnsavedChangesGuard(dirty && !sign.isPending && !signUpload.isPending);

  const focusField = (fieldId: string) => {
    setActiveId(fieldId);
    const el = document.querySelector<HTMLElement>(`[data-field-id="${fieldId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const nextField = () => {
    const next = myFields.find((f) => !isDone(f));
    if (next) focusField(next.id);
    else setReviewOpen(true);
  };

  const openText = (f: SignatureField) => {
    setTextDraft(textValues[f.id] ?? '');
    setTextEdit(f.id);
  };

  const onFieldClick = (f: SignatureField) => {
    setActiveId(f.id);
    if (isImageField(f)) {
      if (!adopted) setCaptureFor(f.id);
      else if (applied.has(f.id)) setCaptureFor('change');
      else setApplied((s) => new Set(s).add(f.id));
    } else if (f.type === 'text') {
      openText(f);
    }
  };

  const onAdopt = (sig: AdoptedSignature) => {
    setAdopted(sig);
    if (captureFor && captureFor !== 'change') setApplied((s) => new Set(s).add(captureFor));
    setCaptureFor(null);
  };

  const finish = () => {
    if (!imagesDone) {
      nextField();
      return;
    }
    setReviewOpen(true);
  };

  const done = (title: string, tone: 'success' | 'warning') => {
    toast({ title, tone });
    leave.allowLeave();
    navigate(`/documents/${doc.id}`);
  };

  const submit = () => {
    if (needsImage && !adopted) return;
    const body: SignBody = {
      decision: 'sign',
      method: needsImage && adopted ? adopted.method : 'click_to_sign',
      ...(needsImage && adopted?.signature_id ? { signature_id: adopted.signature_id } : {}),
      ...(needsImage && adopted?.signature_image ? { signature_image: adopted.signature_image } : {}),
      ...(textFields.length ? { field_values: textFields.map((f) => ({ field_id: f.id, text: textValues[f.id] ?? '' })) } : {}),
    };
    sign.mutate({ requestId: request.id, body }, { onSuccess: () => done('Document signed', 'success'), onError });
  };

  const decline = () =>
    sign.mutate(
      { requestId: request.id, body: { decision: 'decline' } },
      { onSuccess: () => done('Signature declined', 'warning'), onError: (e) => { setDeclineOpen(false); onError(e); } },
    );

  const uploadSigned = () => {
    if (!uploadFile) return;
    signUpload.mutate(
      { requestId: request.id, file: uploadFile },
      { onSuccess: () => done('Signed file uploaded', 'success'), onError },
    );
  };

  const busy = sign.isPending || signUpload.isPending;

  const overlay = (page: RenderedPage) =>
    myFields
      .filter((f) => f.page === page.index)
      .map((f) => {
        const fieldDone = isDone(f);
        const showImage = isImageField(f) && fieldDone && adopted?.previewUrl;
        const text = f.type === 'date' ? today : f.type === 'text' ? (textValues[f.id] ?? '').trim() : '';
        return (
          <button
            key={f.id}
            type="button"
            data-field-id={f.id}
            data-theme="light"
            className={cx(styles.field, fieldDone && styles.fieldDone, activeId === f.id && styles.fieldActive, f.type === 'date' && styles.fieldStatic)}
            style={{
              left: `${Number(f.x) * 100}%`,
              top: `${Number(f.y) * 100}%`,
              width: `${Number(f.w) * 100}%`,
              height: `${Number(f.h) * 100}%`,
            }}
            aria-label={`${labels[f.id]}${fieldDone ? ', done' : ', to do'}`}
            onClick={() => onFieldClick(f)}
          >
            {showImage ? (
              <img src={adopted.previewUrl ?? ''} alt="" className={styles.fieldImage} />
            ) : text ? (
              <span className={styles.fieldText}>{text}</span>
            ) : (
              <span className={styles.fieldHint}>
                {f.type === 'signature' ? 'Click to sign' : f.type === 'initial' ? 'Initial' : labels[f.id]}
              </span>
            )}
          </button>
        );
      });

  const pct = total ? Math.round((doneCount / total) * 100) : 100;
  const editing = textEdit ? myFields.find((f) => f.id === textEdit) : undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        title={`Sign: ${doc.title}`}
        subtitle={request.message ? `“${request.message}”` : 'Review the document and complete your highlighted fields.'}
        actions={
          <>
            <Button variant="tertiary" leftIcon={<ArrowLeft size={16} />} onClick={() => navigate(`/documents/${doc.id}`)}>
              Back
            </Button>
            <Button variant="secondary" leftIcon={<Upload size={16} />} onClick={() => setUploadOpen(true)} disabled={busy}>
              Sign outside the app
            </Button>
            <Button variant="secondary" leftIcon={<XCircle size={16} />} onClick={() => setDeclineOpen(true)} disabled={busy}>
              Decline
            </Button>
          </>
        }
      />

      <div className={styles.layout}>
        <div ref={pane} className={styles.pane}>
          {paneWidth > 0 && (
            <DocumentPreview
              query={fileUrl}
              renderPageOverlay={overlay}
              maxWidth={Math.max(280, Math.min(paneWidth - 32, 1000))}
              viewerClassName={styles.viewer}
            />
          )}
        </div>

        <aside className={styles.panel} aria-label="Your fields">
          <h2 className={styles.panelTitle}>Your fields</h2>
          {total === 0 ? (
            <p className={styles.muted}>No fields were placed for you. Read the document, then use Finish to sign it.</p>
          ) : (
            <ol className={styles.fieldList}>
              {myFields.map((f) => (
                <li key={f.id}>
                  <button type="button" className={cx(styles.fieldRow, activeId === f.id && styles.fieldRowActive)} onClick={() => focusField(f.id)}>
                    {isDone(f) ? <Check size={16} className={styles.okIcon} aria-hidden /> : <Circle size={16} className={styles.todoIcon} aria-hidden />}
                    <span>{labels[f.id]}</span>
                    {f.type === 'date' && <span className={styles.muted}>{today}</span>}
                  </button>
                  {f.type === 'text' && (
                    <Input
                      className={styles.inlineInput}
                      value={textValues[f.id] ?? ''}
                      onChange={(e) => setTextValues((p) => ({ ...p, [f.id]: e.target.value }))}
                      onFocus={() => setActiveId(f.id)}
                      maxLength={200}
                      aria-label={labels[f.id]}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          {myFields.some((f) => f.type === 'date') && (
            <p className={styles.muted}>Date boxes show today. The signing date is stamped when you submit.</p>
          )}
          {needsImage && (
            <div className={styles.adopted}>
              <span className={styles.adoptedLabel}>Your signature</span>
              {adopted?.previewUrl ? (
                <img src={adopted.previewUrl} alt="Your adopted signature" className={styles.adoptedImage} data-theme="light" />
              ) : (
                <span className={styles.muted}>{adopted ? 'Saved signature selected' : 'Not adopted yet'}</span>
              )}
              <Button variant="tertiary" size="sm" leftIcon={<PenLine size={14} />} onClick={() => setCaptureFor('change')}>
                {adopted ? 'Change signature' : 'Adopt signature'}
              </Button>
            </div>
          )}
        </aside>
      </div>

      <div className={styles.bar} role="region" aria-label="Signing progress">
        <div className={styles.progress}>
          <span className={styles.progressText} aria-live="polite">
            {total ? `${doneCount} of ${total} fields done` : 'Ready to sign'}
          </span>
          <span className={styles.track} aria-hidden>
            <span className={styles.fill} style={{ width: `${pct}%` }} />
          </span>
        </div>
        <div className={styles.barActions}>
          {total > 0 && doneCount < total && (
            <Button variant="secondary" size="lg" rightIcon={<ChevronDown size={16} />} onClick={nextField} disabled={busy}>
              Next field
            </Button>
          )}
          <Button leftIcon={<Check size={16} />} variant="primary" size="lg" onClick={finish} disabled={busy}>
            Finish
          </Button>
        </div>
      </div>

      <SignatureCaptureDialog open={captureFor !== null} onClose={() => setCaptureFor(null)} onAdopt={onAdopt} />

      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setTextEdit(null)}
        title={editing ? labels[editing.id] : 'Text'}
        size="sm"
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </ModalClose>
            <Button leftIcon={<Save size={16} />}
              variant="primary"
              type="button"
              onClick={() => {
                if (editing) setTextValues((p) => ({ ...p, [editing.id]: textDraft }));
                setTextEdit(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <FormField label="Text">
          <Input value={textDraft} onChange={(e) => setTextDraft(e.target.value)} maxLength={200} autoFocus />
        </FormField>
      </Modal>

      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={(o) => !o && !sign.isPending && setReviewOpen(false)}
        title="Sign and submit"
        description="A signed copy is stored. The original document is never modified."
        confirmLabel="Sign and submit"
        destructive={false}
        loading={sign.isPending}
        onConfirm={submit}
      >
        <ul className={styles.summary}>
          {needsImage && (
            <li>
              Your signature goes on {myFields.filter(isImageField).length} box{myFields.filter(isImageField).length === 1 ? '' : 'es'}.
            </li>
          )}
          {textFields.length > 0 && (
            <li>
              {textFields.length - blankText.length} of {textFields.length} text field{textFields.length === 1 ? '' : 's'} filled.
            </li>
          )}
          {myFields.some((f) => f.type === 'date') && <li>Date boxes get the signing date.</li>}
          {total === 0 && <li>You are signing the document as a whole.</li>}
        </ul>
        {adopted?.previewUrl && <img src={adopted.previewUrl} alt="Your signature" className={styles.adoptedImage} data-theme="light" />}
        {blankText.length > 0 && (
          <Banner tone="warning" title="Some text fields are blank">
            {blankText.map((f) => labels[f.id]).join(', ')} will be left empty.
          </Banner>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={declineOpen}
        onOpenChange={(o) => !o && !sign.isPending && setDeclineOpen(false)}
        title="Decline to sign"
        confirmLabel="Decline"
        loading={sign.isPending}
        onConfirm={decline}
      >
        <Banner tone="danger" title="Declining is final">
          Declining ends this signature request and marks the document <strong>declined</strong>. No one can sign it afterwards. This can’t be undone.
        </Banner>
      </ConfirmDialog>

      <Modal
        open={uploadOpen}
        onOpenChange={(o) => !o && !signUpload.isPending && setUploadOpen(false)}
        title="Sign outside the app"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setUploadOpen(false)} disabled={signUpload.isPending}>
              Cancel
            </Button>
            <Button leftIcon={<Upload size={16} />} variant="primary" type="button" onClick={uploadSigned} loading={signUpload.isPending} disabled={!uploadFile || signUpload.isPending}>
              Upload signed file
            </Button>
          </>
        }
      >
        <div className={docStyles.form}>
          <p className={docStyles.note}>Download the document, sign it on paper or in another tool, then upload the signed PDF here.</p>
          <DownloadLink query={fileUrl} label="Download the document" />
          <FileUpload accept="application/pdf" multiple={false} hint="Signed PDF" onFiles={(f) => setUploadFile(f[0] ?? null)} />
        </div>
      </Modal>

      {leave.dialog}
    </div>
  );
}
