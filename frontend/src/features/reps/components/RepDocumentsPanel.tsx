/**
 * RepDocumentsPanel — contracts, IDs and other files kept against a rep (SRS HRM-005). The API existed
 * with no screen until now. Listing needs hrm:view; uploading and OPENING a file need hrm:edit, because a
 * rep's ID documents are as sensitive as their SIN (HRM-008) — the server nulls the storage path for
 * everyone else and mints a short-lived signed URL on open. Tokens only.
 */
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Button, FileUpload, FormField, Input, Table, TBody, TD, TH, THead, TR, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { displayDate } from '../../../lib/format/date';
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
  const rows = list.data ?? [];

  const onFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!docType.trim()) {
      toast({ title: 'Name the document first', description: 'e.g. Contract, Photo ID, Void cheque', tone: 'warning' });
      return;
    }
    upload.mutate(
      { file, docType: docType.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Document uploaded', description: docType.trim(), tone: 'success' });
          setDocType('');
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
          <FormField label="Document type" help="What this file is — e.g. Contract, Photo ID, Void cheque.">
            <Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="Contract" maxLength={100} />
          </FormField>
          <FileUpload accept="application/pdf,image/jpeg,image/png" multiple={false} hint="PDF, JPG or PNG — up to 25 MB" onFiles={onFiles} />
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
              <TH>Uploaded</TH>
              <TH align="right">File</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD>{d.doc_type}</TD>
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
