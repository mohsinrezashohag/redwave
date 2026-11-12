/**
 * PhotoPicker — the user's own profile photo on My Account (2026-11-12). Click the photo (pen on hover) to
 * pick a JPG/PNG, crop / zoom / rotate it, and it previews in the circle. The edited image is sent through
 * the unified file pipeline (POST /v1/files, purpose=avatar) and its PATH goes into the change request; the
 * server re-checks it's this user's own JPG/PNG. Nothing changes live until a reviewer approves. Tokens only.
 */
import { useEffect, useState } from 'react';
import { Crop, Trash2 } from 'lucide-react';
import { Button, EditableAvatar, PhotoEditorDialog, type PhotoEditResult } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { uploadStoredFile } from '../../../lib/files/uploadStoredFile';
import styles from './account.module.css';

/** What the form should send: a new path, '' (remove), or undefined (unchanged). */
export type PhotoChange = string | undefined;

export function PhotoPicker({
  name,
  currentUrl,
  value,
  onChange,
}: {
  name: string;
  currentUrl: string | null;
  value: PhotoChange;
  onChange: (next: PhotoChange) => void;
}) {
  const [picked, setPicked] = useState<(PhotoEditResult & { preview: string }) | null>(null);
  const [reEditing, setReEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const onError = useApiErrorToast();

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.preview);
  }, [picked]);

  const shown = value === '' ? null : (picked?.preview ?? currentUrl);

  /** Upload the edited image now (so the request can carry its path); the dialog waits for it. */
  const apply = async (result: PhotoEditResult) => {
    setBusy(true);
    try {
      const stored = await uploadStoredFile({ file: result.file, purpose: 'avatar' });
      setPicked({ ...result, preview: URL.createObjectURL(result.file) });
      onChange(stored.path);
    } catch (e) {
      onError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.photoRow}>
      <EditableAvatar name={name} src={shown} onChange={apply} />
      <div className={styles.photoActions}>
        <span className={styles.help}>
          {busy ? 'Uploading…' : value !== undefined ? 'Submit for review to apply it.' : 'Click the photo to change it (JPG or PNG).'}
        </span>
        <div className={styles.photoButtons}>
          {picked && value && (
            <Button type="button" variant="tertiary" size="sm" leftIcon={<Crop size={14} />} onClick={() => setReEditing(true)}>
              Edit photo
            </Button>
          )}
          {shown && (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              leftIcon={<Trash2 size={14} />}
              onClick={() => {
                setPicked(null);
                onChange(currentUrl ? '' : undefined);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <PhotoEditorDialog
        source={reEditing && picked ? picked.source : null}
        initialCrop={picked?.crop}
        saving={busy}
        onCancel={() => setReEditing(false)}
        onSave={(r) => {
          void apply(r)
            .then(() => setReEditing(false))
            .catch(() => undefined);
        }}
      />
    </div>
  );
}
