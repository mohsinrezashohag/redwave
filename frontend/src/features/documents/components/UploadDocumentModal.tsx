/**
 * UploadDocumentModal — create a document (documents:create) from a REAL PDF through the unified upload
 * pipeline: the file goes to POST /v1/files (purpose=document, with a per-file progress bar), then the
 * JSON create CLAIMS the stored path (server-validated: own upload + PDF — DOC-001). The display name
 * defaults to the title. The 10 MB pipeline cap applies. On success → the detail page.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  FileUpload,
  FormField,
  Input,
  Modal,
  Select,
  useToast,
  type FileUploadState,
} from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useUploadDocument } from '../api/useDocumentMutations';
import { DOC_TYPE_LABELS } from '../documents.types';
import styles from './documents.module.css';
import type { DocType } from '../documents.types';

const TYPE_OPTIONS = (Object.keys(DOC_TYPE_LABELS) as DocType[]).map((v) => ({ value: v, label: DOC_TYPE_LABELS[v] }));

export function UploadDocumentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const upload = useUploadDocument();
  const [title, setTitle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [docType, setDocType] = useState<DocType>('compensation_agreement');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);

  const isPdf = !!file && file.type === 'application/pdf';
  const canSubmit = !!title.trim() && isPdf && !upload.isPending;

  const uploadState: Record<string, FileUploadState> | undefined =
    file && upload.isPending ? { [file.name]: { status: 'uploading', progress } } : undefined;

  const onSubmit = () => {
    if (!file || !title.trim()) return;
    setProgress(0);
    upload.mutate(
      {
        file,
        title: title.trim(),
        doc_type: docType,
        display_name: displayName.trim() || undefined, // server records the title when omitted (mutation default)
        onProgress: setProgress,
      },
      {
        onSuccess: (doc) => {
          toast({ title: 'Document uploaded', tone: 'success' });
          setTitle('');
          setDisplayName('');
          setFile(null);
          onClose();
          navigate(`/documents/${doc.id}`);
        },
        onError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !upload.isPending && onClose()}
      title="Upload document"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={onSubmit} loading={upload.isPending} disabled={!canSubmit}>
            Upload
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <FormField label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Compensation Agreement 2026" maxLength={200} />
        </FormField>
        <FormField label="Display name" help="Shown in file listings; defaults to the title.">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={title.trim() || 'Defaults to the title'}
            maxLength={200}
          />
        </FormField>
        <FormField label="Type">
          <Select options={TYPE_OPTIONS} value={docType} onValueChange={(v) => setDocType(v as DocType)} />
        </FormField>
        <FormField label="PDF file" required help="PDF only. Save Word documents as PDF before uploading.">
          <FileUpload
            accept="application/pdf"
            multiple={false}
            hint="PDF up to 10 MB"
            uploads={uploadState}
            onFiles={(files) => setFile(files[0] ?? null)}
          />
        </FormField>
        {file && !isPdf && (
          <Banner tone="warning" title="PDF required">
            “{file.name}” isn’t a PDF. Please save it as a PDF and upload again.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
