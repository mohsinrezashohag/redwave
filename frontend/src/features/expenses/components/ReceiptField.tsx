/**
 * ReceiptField — the receipt control for a non-km item (FE-4). Selecting a file COMPRESSES images
 * in-browser (max 2000px long edge → JPEG 0.8; PDFs pass through), uploads through the unified
 * POST /v1/files pipeline (purpose=receipt) with a per-file progress bar + retry, and stores the
 * SERVER-GENERATED PATH on the item (claim-validated at submit). Viewing goes through the item's
 * receipt-url endpoint (60s signed URL) — never a long-lived URL on the row. Mobile browsers offer the
 * camera (accept image/* + capture). The "required" marker lives on the parent FormField. Tokens only.
 */
import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, FileText } from 'lucide-react';
import { Button, FileUpload, type FileUploadState } from '../../../components/ui';
import { prepareForUpload } from '../../../lib/files/compressImage';
import { uploadStoredFile } from '../../../lib/files/uploadStoredFile';
import styles from './expenses.module.css';

export function ReceiptField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [state, setState] = useState<FileUploadState | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const lastFile = useRef<File | null>(null);
  const thumbUrl = useRef<string | null>(null);

  // Revoke the preview object URL when the field unmounts.
  useEffect(
    () => () => {
      if (thumbUrl.current) URL.revokeObjectURL(thumbUrl.current);
    },
    [],
  );

  const startUpload = async (original: File) => {
    lastFile.current = original;
    setFileName(original.name);
    if (thumbUrl.current) URL.revokeObjectURL(thumbUrl.current);
    thumbUrl.current = original.type.startsWith('image/') ? URL.createObjectURL(original) : null;
    setState({ status: 'uploading', progress: 0, thumbnailUrl: thumbUrl.current ?? undefined });
    try {
      const prepared = await prepareForUpload(original); // images → ≤2000px JPEG 0.8; PDFs untouched
      const stored = await uploadStoredFile({
        file: prepared,
        purpose: 'receipt',
        displayName: original.name,
        onProgress: (pct) => setState((s) => (s ? { ...s, progress: pct } : s)),
      });
      setState({ status: 'done', thumbnailUrl: thumbUrl.current ?? undefined });
      onChange(stored.path); // the server-generated path — claim-validated at item submit
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed. Please try again.',
        thumbnailUrl: thumbUrl.current ?? undefined,
      });
    }
  };

  if (value) {
    const isImage = !!thumbUrl.current;
    return (
      <div className={styles.receiptRow}>
        {isImage ? (
          <img src={thumbUrl.current!} alt="Receipt preview" className={styles.receiptThumb} />
        ) : (
          <FileText size={16} aria-hidden />
        )}
        <span className={styles.receiptRef}>{fileName ?? value}</span>
        <Button
          variant="tertiary"
          size="sm"
          type="button"
          onClick={() => {
            setState(null);
            setFileName(null);
            onChange(undefined);
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div>
      <FileUpload
        accept="image/*,.pdf"
        capture="environment"
        multiple={false}
        hint="Photo or PDF — images are compressed automatically (max 10 MB)"
        uploads={fileName && state ? { [fileName]: state } : undefined}
        onRetry={() => lastFile.current && void startUpload(lastFile.current)}
        onFiles={(files) => {
          const f = files[0];
          if (f) void startUpload(f);
        }}
      />
      {!state && (
        <p className={styles.previewNote}>
          <ImageIcon size={12} aria-hidden /> On mobile, the camera opens directly.
        </p>
      )}
    </div>
  );
}
