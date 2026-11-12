/**
 * RepDocumentsPanel — contracts, IDs and other files kept against a rep (SRS HRM-005). Listing needs
 * hrm:view; uploading and OPENING a file need hrm:edit, because a rep's ID documents are as sensitive as
 * their SIN (HRM-008) — the server nulls the storage path for everyone else and mints a short-lived signed
 * URL on open. Tokens only.
 *
 * 2026-11-12: the type is picked from a fixed list (banking / headshot / immigration / government ID / …), a
 * headshot must be a JPG or PNG, and permits, PR cards, licences and passports carry ISSUE and EXPIRY dates
 * (expiry flagged "Expired" / "Expires in N days" within 60). For those IDs the dates are READ from the
 * document automatically (when set up) and shown with consistency checks for HR to confirm before saving;
 * "Dates" on a row reads or edits them for a document already on file. The server re-checks every rule.
 */
import { useState } from 'react';
import { CalendarClock, FileText } from 'lucide-react';
import { Badge, Button, FileUpload, FormField, Select, Table, TBody, TD, TH, THead, TR, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { displayDate, todayIso } from '../../../lib/format/date';
import { acceptFor, docTypeLabel, EXPIRING_DOC_TYPES, expiryStatus, readFailureNote, REP_DOC_TYPES } from '../repDocTypes';
import {
  useMyDocumentUrl,
  useMyDocuments,
  useReadDocumentUpload,
  useReadStoredDocument,
  useRepDocumentUrl,
  useRepDocuments,
  useUpdateDocumentDates,
  useUploadRepDocument,
} from '../api/useRepProfile';
import type { DocumentRead, RepDocument } from '../reps.types';
import { DocumentDatesReview, type DocumentDates } from './DocumentDatesReview';
import styles from './reps.module.css';

/** What the dates panel is working on: a file about to be uploaded, or a document already on file. */
type Review = { mode: 'upload'; file: File; docType: string } | { mode: 'stored'; doc: RepDocument };

/**
 * `self` = the signed-in rep's own documents (My Account): they may LIST and OPEN their own files (e.g. their
 * contract) through the token-scoped endpoints, but not upload — documents are admin-managed.
 */
export function RepDocumentsPanel({ repId, self = false }: { repId: string; self?: boolean }) {
  const isHr = useCan('hrm:edit');
  const canEdit = isHr && !self;
  const canOpen = isHr || self;
  // Both sources are wired (rules of hooks); only the one for this view is enabled / used.
  const adminList = useRepDocuments(repId, !self);
  const ownList = useMyDocuments(self);
  const list = self ? ownList : adminList;
  const upload = useUploadRepDocument(repId);
  const readUpload = useReadDocumentUpload(repId);
  const readStored = useReadStoredDocument(repId);
  const saveDates = useUpdateDocumentDates(repId);
  const adminOpen = useRepDocumentUrl(repId);
  const ownOpen = useMyDocumentUrl();
  const open = self ? ownOpen : adminOpen;
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const [docType, setDocType] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [read, setRead] = useState<DocumentRead | null>(null);
  const [note, setNote] = useState<string | null>(null);
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

  const onFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!docType) {
      toast({ title: 'Pick the document type first', tone: 'warning' });
      return;
    }
    if (docType === 'headshot' && !/^image\/(png|jpe?g)$/.test(file.type)) {
      toast({ title: 'A headshot must be a JPG or PNG photo', tone: 'warning' });
      return;
    }
    if (EXPIRING_DOC_TYPES.has(docType)) {
      // An ID: read its dates first, then HR confirms them before anything is saved.
      startReview({ mode: 'upload', file, docType });
      readUpload.mutate({ file, docType }, handleRead);
      return;
    }
    doUpload(file, docType, {});
  };

  const doUpload = (file: File, type: string, dates: Partial<DocumentDates>) =>
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

  const onOpenFile = (docId: string) =>
    open.mutate(docId, {
      onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer'),
      onError,
    });

  /** "Dates" on a row: open the panel; read the document straight away when it has no dates yet. */
  const editDates = (doc: RepDocument) => {
    startReview({ mode: 'stored', doc });
    if (!doc.issued_on && !doc.expires_on) readStored.mutate(doc.id, handleRead);
  };

  const onSaveDates = (dates: DocumentDates) => {
    if (!review) return;
    if (review.mode === 'upload') {
      doUpload(review.file, review.docType, dates);
      return;
    }
    saveDates.mutate(
      { docId: review.doc.id, ...dates },
      {
        onSuccess: () => {
          toast({ title: 'Dates saved', description: docTypeLabel(review.doc.doc_type), tone: 'success' });
          closeReview();
        },
        onError,
      },
    );
  };

  const reviewDoc = review?.mode === 'stored' ? review.doc : null;

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
              <TH align="right">File</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD>{docTypeLabel(d.doc_type)}</TD>
                <TD className="mono">{d.issued_on ? displayDate(d.issued_on) : ''}</TD>
                <TD>
                  <ExpiryCell expiresOn={d.expires_on} today={today} />
                </TD>
                <TD className="mono">{displayDate(d.uploaded_at)}</TD>
                <TD align="right">
                  <span className={styles.fileActions}>
                    {canEdit && EXPIRING_DOC_TYPES.has(d.doc_type) && (
                      <Button variant="tertiary" size="sm" leftIcon={<CalendarClock size={14} />} onClick={() => editDates(d)}>
                        Dates
                      </Button>
                    )}
                    {canOpen ? (
                      <Button
                        variant="tertiary"
                        size="sm"
                        leftIcon={<FileText size={14} />}
                        onClick={() => onOpenFile(d.id)}
                        loading={open.isPending && open.variables === d.id}
                      >
                        Open
                      </Button>
                    ) : (
                      <span className={styles.muted}>Restricted</span>
                    )}
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>

      <DocumentDatesReview
        open={review !== null}
        title={review?.mode === 'upload' ? `${docTypeLabel(review.docType)}: confirm the dates` : `${reviewDoc ? docTypeLabel(reviewDoc.doc_type) : ''}: dates`}
        initial={{ issued_on: reviewDoc?.issued_on ?? null, expires_on: reviewDoc?.expires_on ?? null }}
        read={read}
        reading={reading}
        note={note}
        saving={upload.isPending || saveDates.isPending}
        saveLabel={review?.mode === 'upload' ? 'Save document' : 'Save dates'}
        onReadAgain={reviewDoc ? () => readStored.mutate(reviewDoc.id, handleRead) : undefined}
        onSave={onSaveDates}
        onCancel={closeReview}
      />
    </>
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
