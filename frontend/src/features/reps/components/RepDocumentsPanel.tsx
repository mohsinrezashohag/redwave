/**
 * RepDocumentsPanel — contracts, IDs and other files kept against a rep (SRS HRM-005). Listing needs
 * hrm:view; uploading and OPENING a file need hrm:edit, because a rep's ID documents are as sensitive as
 * their SIN (HRM-008) — the server nulls the storage path for everyone else and mints a short-lived signed
 * URL on open. Tokens only.
 *
 * 2026-11-12: the type is picked from a fixed list (banking / headshot / immigration / government ID / …), a
 * headshot must be a JPG or PNG, and permits, PR cards, licences and passports carry ISSUE and EXPIRY dates
 * (expiry flagged "Expired" / "Expires in N days" within 60). For those IDs the dates are READ from the
 * document automatically (when set up) and shown with consistency checks for HR to confirm before saving.
 *
 * Each row: Open · Edit (type + dates) · Replace file (hrm:edit) · Delete (hrm:delete). Delete moves the
 * document to "Recently deleted", restorable for 30 days; the server's daily purge then removes it for good.
 * Gating here only hides buttons; the server enforces every permission.
 */
import { useRef, useState } from 'react';
import { FileText, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  FileUpload,
  FormField,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useConfirm,
  useToast,
  type MenuEntry,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { RowActions } from '../../../components/data/RowActions';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { displayDate, todayIso } from '../../../lib/format/date';
import { acceptFor, docTypeLabel, EXPIRING_DOC_TYPES, expiryStatus, readFailureNote, REP_DOC_TYPES } from '../repDocTypes';
import {
  useDeleteRepDocument,
  useDeletedRepDocuments,
  useMyDocumentUrl,
  useMyDocuments,
  useReadDocumentUpload,
  useReadStoredDocument,
  useReplaceRepDocument,
  useRepDocumentUrl,
  useRepDocuments,
  useRestoreRepDocument,
  useUpdateRepDocument,
  useUploadRepDocument,
} from '../api/useRepProfile';
import type { DeletedRepDocument, DocumentRead, RepDocument } from '../reps.types';
import { DocumentDatesReview, type DocumentEdit } from './DocumentDatesReview';
import styles from './reps.module.css';

/** What the review panel is working on: a new upload, a replacement file, or a document already on file. */
type Review =
  | { mode: 'upload'; file: File; docType: string }
  | { mode: 'replace'; file: File; doc: RepDocument }
  | { mode: 'edit'; doc: RepDocument };

const isImage = (file: File) => /^image\/(png|jpe?g)$/.test(file.type);

/**
 * `self` = the signed-in rep's own documents (My Account): they may LIST and OPEN their own files (e.g. their
 * contract) through the token-scoped endpoints, but not upload — documents are admin-managed.
 */
export function RepDocumentsPanel({ repId, self = false }: { repId: string; self?: boolean }) {
  const isHr = useCan('hrm:edit');
  const canRemove = useCan('hrm:delete') && !self;
  const canEdit = isHr && !self;
  const canOpen = isHr || self;
  // Both sources are wired (rules of hooks); only the one for this view is enabled / used.
  const adminList = useRepDocuments(repId, !self);
  const ownList = useMyDocuments(self);
  const list = self ? ownList : adminList;
  const upload = useUploadRepDocument(repId);
  const replace = useReplaceRepDocument(repId);
  const update = useUpdateRepDocument(repId);
  const remove = useDeleteRepDocument(repId);
  const readUpload = useReadDocumentUpload(repId);
  const readStored = useReadStoredDocument(repId);
  const adminOpen = useRepDocumentUrl(repId);
  const ownOpen = useMyDocumentUrl();
  const open = self ? ownOpen : adminOpen;
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [docType, setDocType] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [read, setRead] = useState<DocumentRead | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<RepDocument | null>(null);
  const today = todayIso();
  const rows = list.data ?? [];
  const reading = readUpload.isPending || readStored.isPending;

  const startReview = (next: Review) => {
    setRead(null);
    setNote(null);
    setReview(next);
  };
  const closeReview = () => {
    setReview(null);
    setRead(null);
    setNote(null);
  };
  const handleRead = { onSuccess: (r: DocumentRead) => setRead(r), onError: (e: unknown) => setNote(readFailureNote(e)) };

  // ── New upload ────────────────────────────────────────────────────────────────────────────────
  const onFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!docType) {
      toast({ title: 'Pick the document type first', tone: 'warning' });
      return;
    }
    if (docType === 'headshot' && !isImage(file)) {
      toast({ title: 'A headshot must be a JPG or PNG photo', tone: 'warning' });
      return;
    }
    if (EXPIRING_DOC_TYPES.has(docType)) {
      // An ID: read its dates first, then HR confirms them before anything is saved.
      startReview({ mode: 'upload', file, docType });
      readUpload.mutate({ file, docType }, handleRead);
      return;
    }
    doUpload(file, docType, { issued_on: null, expires_on: null });
  };

  const doUpload = (file: File, type: string, dates: Pick<DocumentEdit, 'issued_on' | 'expires_on'>) =>
    upload.mutate(
      { file, docType: type, expiresOn: dates.expires_on ?? undefined, issuedOn: dates.issued_on ?? undefined },
      {
        onSuccess: () => {
          toast({ title: 'Document uploaded', description: docTypeLabel(type), tone: 'success' });
          setDocType('');
          closeReview();
        },
        onError,
      },
    );

  // ── Replace file ──────────────────────────────────────────────────────────────────────────────
  const pickReplacement = (doc: RepDocument) => {
    setReplacing(doc);
    replaceInput.current?.click();
  };

  const onReplacementPicked = (file: File | undefined) => {
    const doc = replacing;
    setReplacing(null);
    if (replaceInput.current) replaceInput.current.value = '';
    if (!file || !doc) return;
    if (doc.doc_type === 'headshot' && !isImage(file)) {
      toast({ title: 'A headshot must be a JPG or PNG photo', tone: 'warning' });
      return;
    }
    if (EXPIRING_DOC_TYPES.has(doc.doc_type)) {
      // A new ID file usually means new dates: read them, HR confirms, then the file is swapped.
      startReview({ mode: 'replace', file, doc });
      readUpload.mutate({ file, docType: doc.doc_type }, handleRead);
      return;
    }
    doReplace(doc, file, { issued_on: null, expires_on: null });
  };

  const doReplace = (doc: RepDocument, file: File, dates: Pick<DocumentEdit, 'issued_on' | 'expires_on'>) =>
    replace.mutate(
      { docId: doc.id, file, issuedOn: dates.issued_on ?? undefined, expiresOn: dates.expires_on ?? undefined },
      {
        onSuccess: () => {
          toast({
            title: 'File replaced',
            description: `${docTypeLabel(doc.doc_type)}. The old file is in Recently deleted for 30 days.`,
            tone: 'success',
          });
          closeReview();
        },
        onError,
      },
    );

  // ── Edit / delete ─────────────────────────────────────────────────────────────────────────────
  /** Edit on a row: open the panel; for an ID with no dates yet, read them straight away. */
  const editDoc = (doc: RepDocument) => {
    startReview({ mode: 'edit', doc });
    if (EXPIRING_DOC_TYPES.has(doc.doc_type) && !doc.issued_on && !doc.expires_on) readStored.mutate(doc.id, handleRead);
  };

  const askDelete = (doc: RepDocument) =>
    confirm({
      title: `Move ${docTypeLabel(doc.doc_type)} to Recently deleted?`,
      description: 'You can restore it for 30 days. After that it is removed for good.',
      confirmLabel: 'Delete',
      onConfirm: () =>
        remove.mutate(doc.id, {
          onSuccess: () =>
            toast({
              title: 'Moved to Recently deleted',
              description: `${docTypeLabel(doc.doc_type)} can be restored for 30 days.`,
              tone: 'success',
            }),
          onError,
        }),
    });

  const onSave = (edit: DocumentEdit) => {
    if (!review) return;
    if (review.mode === 'upload') return doUpload(review.file, review.docType, edit);
    if (review.mode === 'replace') return doReplace(review.doc, review.file, edit);
    const doc = review.doc;
    update.mutate(
      { docId: doc.id, doc_type: edit.doc_type, issued_on: edit.issued_on, expires_on: edit.expires_on },
      {
        onSuccess: () => {
          toast({ title: 'Document updated', description: docTypeLabel(edit.doc_type), tone: 'success' });
          closeReview();
        },
        onError,
      },
    );
  };

  const onOpenFile = (docId: string) =>
    open.mutate(docId, {
      onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer'),
      onError,
    });

  const rowMenu = (d: RepDocument): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (canOpen) items.push({ label: 'Open', icon: <FileText size={14} />, onSelect: () => onOpenFile(d.id) });
    if (canEdit) {
      items.push({ label: 'Edit', icon: <Pencil size={14} />, onSelect: () => editDoc(d) });
      items.push({ label: 'Replace file', icon: <Upload size={14} />, onSelect: () => pickReplacement(d) });
    }
    if (canRemove) items.push('separator', { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => askDelete(d) });
    return items;
  };

  const reviewDoc = review && review.mode !== 'upload' ? review.doc : null;
  const reviewType = review?.mode === 'upload' ? review.docType : (reviewDoc?.doc_type ?? '');
  const title =
    review?.mode === 'upload'
      ? `${docTypeLabel(reviewType)}: confirm the dates`
      : review?.mode === 'replace'
        ? `Replace ${docTypeLabel(reviewType)}: confirm the dates`
        : `Edit ${docTypeLabel(reviewType)}`;

  return (
    <>
      {canEdit && (
        <div className={styles.upload}>
          <div className={styles.grid2}>
            <FormField
              label="Document type"
              required
              help={EXPIRING_DOC_TYPES.has(docType) ? 'We’ll read the issue and expiry dates for you to confirm.' : undefined}
            >
              <Select
                options={REP_DOC_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                value={docType}
                onValueChange={setDocType}
                placeholder="Choose…"
                aria-label="Document type"
              />
            </FormField>
          </div>
          <FileUpload
            accept={acceptFor(docType)}
            multiple={false}
            hint={docType === 'headshot' ? 'JPG or PNG photo, up to 25 MB' : 'PDF, JPG or PNG, up to 25 MB'}
            onFiles={onFiles}
          />
          {/* Hidden picker behind "Replace file" on a row. */}
          <input
            ref={replaceInput}
            type="file"
            hidden
            accept={replacing ? acceptFor(replacing.doc_type) : undefined}
            onChange={(e) => onReplacementPicked(e.target.files?.[0])}
            aria-label="Replacement file"
          />
        </div>
      )}
      <DataState
        isLoading={list.isLoading}
        isError={list.isError}
        isEmpty={rows.length === 0}
        onRetry={() => list.refetch()}
        emptyNode={<p className={styles.muted}>{self ? 'No documents on file for you yet.' : 'No documents on file for this rep.'}</p>}
      >
        <Table>
          <THead>
            <TR>
              <TH>Document</TH>
              <TH>Issued</TH>
              <TH>Expires</TH>
              <TH>Uploaded</TH>
              <TH align="right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => {
              const menu = rowMenu(d);
              return (
                <TR key={d.id}>
                  <TD>{docTypeLabel(d.doc_type)}</TD>
                  <TD className="mono">{d.issued_on ? displayDate(d.issued_on) : ''}</TD>
                  <TD>
                    <ExpiryCell expiresOn={d.expires_on} today={today} />
                  </TD>
                  <TD className="mono">{displayDate(d.uploaded_at)}</TD>
                  <TD align="right">
                    {menu.length > 0 ? (
                      <RowActions label={`${docTypeLabel(d.doc_type)} actions`} items={menu} />
                    ) : (
                      <span className={styles.muted}>Restricted</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </DataState>

      {canRemove && <RecentlyDeleted repId={repId} />}

      <DocumentDatesReview
        open={review !== null}
        title={title}
        editType={review?.mode === 'edit'}
        initial={{
          doc_type: reviewType,
          issued_on: review?.mode === 'edit' ? review.doc.issued_on : null,
          expires_on: review?.mode === 'edit' ? review.doc.expires_on : null,
        }}
        read={read}
        reading={reading}
        note={note}
        saving={upload.isPending || replace.isPending || update.isPending}
        saveLabel={review?.mode === 'upload' ? 'Save document' : review?.mode === 'replace' ? 'Replace file' : 'Save changes'}
        onReadAgain={review?.mode === 'edit' ? () => readStored.mutate(review.doc.id, handleRead) : undefined}
        onSave={onSave}
        onCancel={closeReview}
      />
      {confirmDialog}
    </>
  );
}

/**
 * Recently deleted (hrm:delete): documents that can still be restored, with who deleted them and the day the
 * purge removes them for good. Collapsed by default; hidden when the bin is empty.
 */
function RecentlyDeleted({ repId }: { repId: string }) {
  const deleted = useDeletedRepDocuments(repId);
  const restore = useRestoreRepDocument(repId);
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const rows: DeletedRepDocument[] = deleted.data ?? [];
  if (rows.length === 0) return null;

  const onRestore = (d: DeletedRepDocument) =>
    restore.mutate(d.id, {
      onSuccess: () => toast({ title: 'Document restored', description: docTypeLabel(d.doc_type), tone: 'success' }),
      onError,
    });

  return (
    <details className={styles.recentlyDeleted}>
      <summary className={styles.recentlyDeletedSummary}>Recently deleted ({rows.length})</summary>
      <p className={styles.muted}>Deleted documents can be restored for 30 days. After that they are removed for good.</p>
      <Table>
        <THead>
          <TR>
            <TH>Document</TH>
            <TH>Deleted by</TH>
            <TH>Deleted on</TH>
            <TH>Removed for good on</TH>
            <TH align="right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((d) => (
            <TR key={d.id}>
              <TD>{docTypeLabel(d.doc_type)}</TD>
              <TD>{d.deleted_by_name ?? '—'}</TD>
              <TD className="mono">{d.deleted_at ? displayDate(d.deleted_at) : '—'}</TD>
              <TD className="mono">{displayDate(d.purge_on)}</TD>
              <TD align="right">
                <Button
                  variant="tertiary"
                  size="sm"
                  leftIcon={<RotateCcw size={14} />}
                  onClick={() => onRestore(d)}
                  loading={restore.isPending && restore.variables === d.id}
                >
                  Restore
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </details>
  );
}

/** "2027-06-30" + an Expired / Expires-in-N-days badge; blank for documents that don't expire. */
function ExpiryCell({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  const status = expiryStatus(expiresOn, today);
  if (!status || !expiresOn) return null;
  return (
    <span className={styles.sinRow}>
      <span className="mono">{displayDate(expiresOn)}</span>
      {status.kind === 'expired' && <Badge tone="danger">Expired</Badge>}
      {status.kind === 'soon' && (
        <Badge tone="warning">{status.days === 0 ? 'Expires today' : `Expires in ${status.days} days`}</Badge>
      )}
    </span>
  );
}
