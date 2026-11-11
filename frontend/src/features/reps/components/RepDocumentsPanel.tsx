/**
 * RepDocumentsPanel — contracts, IDs and other files kept against a rep (SRS HRM-005). The API existed
 * with no screen until now. Listing needs hrm:view; uploading and OPENING a file need hrm:edit, because a
 * rep's ID documents are as sensitive as their SIN (HRM-008) — the server nulls the storage path for
 * everyone else and mints a short-lived signed URL on open. Tokens only.
 *
 * 2026-11-12: the type is picked from a fixed list (banking / headshot / immigration / government ID / …), a
 * headshot must be a JPG or PNG, and permits, PR cards, licences and passports carry an EXPIRY date shown as
 * "Expired" or "Expires in N days" (within 60). The server re-checks every rule.
 */
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Badge, Button, DatePicker, FileUpload, FormField, Select, Table, TBody, TD, TH, THead, TR, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { displayDate, todayIso } from '../../../lib/format/date';
import { acceptFor, docTypeLabel, EXPIRING_DOC_TYPES, expiryStatus, REP_DOC_TYPES } from '../repDocTypes';
import { useMyDocumentUrl, useMyDocuments, useRepDocumentUrl, useRepDocuments, useUploadRepDocument } from '../api/useRepProfile';
import styles from './reps.module.css';

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
  const adminOpen = useRepDocumentUrl(repId);
  const ownOpen = useMyDocumentUrl();
  const open = self ? ownOpen : adminOpen;
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const [docType, setDocType] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const expires = EXPIRING_DOC_TYPES.has(docType);
  const today = todayIso();
  const rows = list.data ?? [];

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
    upload.mutate(
      { file, docType, expiresOn: expires && expiresOn ? expiresOn : undefined },
      {
        onSuccess: () => {
          toast({ title: 'Document uploaded', description: docTypeLabel(docType), tone: 'success' });
          setDocType('');
          setExpiresOn('');
        },
        onError,
      },
    );
  };

  const onOpen = (docId: string) =>
    open.mutate(docId, {
      onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer'),
      onError,
    });

  return (
    <>
      {canEdit && (
        <div className={styles.upload}>
          <div className={styles.grid2}>
            <FormField label="Document type" required>
              <Select
                options={REP_DOC_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                value={docType}
                onValueChange={setDocType}
                placeholder="Choose…"
                aria-label="Document type"
              />
            </FormField>
            {expires && (
              <FormField label="Expires on" help="We flag it 60 days before it expires.">
                <DatePicker value={expiresOn} onChange={setExpiresOn} clearable aria-label="Expires on" />
              </FormField>
            )}
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
              <TH>Expires</TH>
              <TH>Uploaded</TH>
              <TH align="right">File</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD>{docTypeLabel(d.doc_type)}</TD>
                <TD>
                  <ExpiryCell expiresOn={d.expires_on} today={today} />
                </TD>
                <TD className="mono">{displayDate(d.uploaded_at)}</TD>
                <TD align="right">
                  {canOpen ? (
                    <Button variant="tertiary" size="sm" leftIcon={<FileText size={14} />} onClick={() => onOpen(d.id)} loading={open.isPending && open.variables === d.id}>
                      Open
                    </Button>
                  ) : (
                    <span className={styles.muted}>Restricted</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>
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
