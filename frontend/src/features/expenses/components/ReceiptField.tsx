/**
 * ReceiptField — the receipt control for a non-km item (FE-4). Selecting a file UPLOADS it to
 * POST /v1/expense-receipts and stores the returned access-controlled URL on the item; when storage is
 * unconfigured the server returns a selection-only reference (graceful). Shows upload progress + errors and
 * the current ref with Remove. The "required" marker lives on the parent FormField (config-driven). Tokens only.
 */
import { Button, FileUpload, LoadingSpinner } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useUploadReceipt } from '../api/useExpenseMutations';
import styles from './expenses.module.css';

export function ReceiptField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const upload = useUploadReceipt();
  const onError = useApiErrorToast('Receipt upload failed. Please try again.');

  if (upload.isPending) {
    return (
      <div className={styles.receiptRow}>
        <LoadingSpinner size="sm" label="Uploading receipt" />
        <span className={styles.previewNote}>Uploading…</span>
      </div>
    );
  }

  if (value) {
    return (
      <div className={styles.receiptRow}>
        <span className={styles.receiptRef}>{value}</span>
        <Button variant="tertiary" size="sm" type="button" onClick={() => onChange(undefined)}>
          Remove
        </Button>
      </div>
    );
  }

  return (
    <FileUpload
      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
      multiple={false}
      hint="PDF/JPG/PNG — uploaded to secure storage (max 10 MB)"
      onFiles={(files) => {
        const f = files[0];
        if (!f) return;
        upload.mutate(f, {
          onSuccess: (res) => onChange(res.url),
          onError,
        });
      }}
    />
  );
}
