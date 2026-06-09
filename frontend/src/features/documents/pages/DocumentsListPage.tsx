/**
 * DocumentsListPage — /documents. The documents the user can SEE (owner OR recipient; Admin/Super see all) —
 * the SERVER returns only visible ones; the UI renders what's returned (it never filters by visibility). The
 * overall status is server-derived (displayed via DocumentStatusBadge). `documents:view` to see; `documents:
 * create` to upload. 403 → AccessDenied; the server is the real gate (§5).
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { Button, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { DataState } from '../../../components/data/DataState';
import { isForbidden } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useDocuments } from '../api/useDocuments';
import { useUserLookup } from '../api/useUserLookup';
import { DocumentStatusBadge } from '../components/DocumentStatusBadge';
import { UploadDocumentModal } from '../components/UploadDocumentModal';
import { DOC_TYPE_LABELS } from '../documents.types';
import styles from '../components/documents.module.css';
import type { DocType, DocumentStatus } from '../documents.types';

const ALL = '__all__';
const STATUS_OPTIONS = [
  { value: ALL, label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'shared', label: 'Shared' },
  { value: 'partially_signed', label: 'Partially signed' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
];
const TYPE_OPTIONS = [{ value: ALL, label: 'All types' }, ...(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((v) => ({ value: v, label: DOC_TYPE_LABELS[v] }))];

export default function DocumentsListPage() {
  const canView = useCan('documents:view');
  const canCreate = useCan('documents:create');
  const [params] = useSearchParams();
  // The Operations "Signature requests" card deep-links here as ?queue=awaiting-signatures (server-filtered).
  const awaitingSignatures = params.get('queue') === 'awaiting-signatures';
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all');
  const [docType, setDocType] = useState<DocType | 'all'>('all');
  const [uploadOpen, setUploadOpen] = useState(false);

  const q = useDocuments(
    {
      status: status === 'all' ? undefined : status,
      doc_type: docType === 'all' ? undefined : docType,
      pending_signatures: awaitingSignatures || undefined,
    },
    canView,
  );
  const { resolve } = useUserLookup();

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing documents requires the documents view permission." />;
  }

  const rows = q.data ?? [];

  return (
    <div className={styles.page}>
      <PageHeader
        title={awaitingSignatures ? 'Documents awaiting signatures' : 'Documents'}
        subtitle={
          awaitingSignatures
            ? 'Documents with at least one pending signature request.'
            : 'Upload, share for signature, and track signing. You see documents you own or are asked to sign.'
        }
        actions={
          canCreate ? (
            <Button variant="primary" leftIcon={<Upload size={16} />} onClick={() => setUploadOpen(true)}>
              Upload
            </Button>
          ) : undefined
        }
      />

      <div className={styles.controls}>
        <div className={styles.control}>
          <Select options={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v === ALL ? 'all' : (v as DocumentStatus))} aria-label="Status filter" />
        </div>
        <div className={styles.control}>
          <Select options={TYPE_OPTIONS} value={docType} onValueChange={(v) => setDocType(v === ALL ? 'all' : (v as DocType))} aria-label="Type filter" />
        </div>
      </div>

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No documents to show.</p>}
      >
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Owner</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH align="right" aria-label="View" />
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD>{d.title}</TD>
                <TD>{DOC_TYPE_LABELS[d.doc_type]}</TD>
                <TD>{resolve(d.owner_user_id).label}</TD>
                <TD>
                  <DocumentStatusBadge status={d.status} />
                </TD>
                <TD>
                  <span className="mono">{displayDate(d.created_at)}</span>
                </TD>
                <TD align="right">
                  <Link to={`/documents/${d.id}`}>View</Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
