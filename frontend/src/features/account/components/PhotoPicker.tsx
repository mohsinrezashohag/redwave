/**
 * PhotoPicker — upload a profile photo (JPG/PNG) instead of pasting a link (client request 2026-11-12).
 * The image is downscaled in the browser (`prepareForUpload`), sent through the unified file pipeline
 * (POST /v1/files, purpose=avatar), and the returned storage PATH goes into the change request; the server
 * re-checks it's this user's own JPG/PNG. Shows a local preview until the request is approved. Tokens only.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Avatar, Button, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { prepareForUpload } from '../../../lib/files/compressImage';
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
  const input = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const { toast } = useToast();
  const onError = useApiErrorToast();

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = value === '' ? null : (preview ?? currentUrl);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast({ title: 'A photo must be a JPG or PNG image', tone: 'warning' });
      return;
    }
    setProgress(0);
    try {
      const ready = await prepareForUpload(file);
      const stored = await uploadStoredFile({ file: ready, purpose: 'avatar', onProgress: setProgress });
      setPreview(URL.createObjectURL(ready));
      onChange(stored.path);
    } catch (e) {
      onError(e);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={styles.photoRow}>
      <Avatar name={name} src={shown} size="lg" />
      <div className={styles.photoActions}>
        <div className={styles.photoButtons}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<ImagePlus size={14} />}
            loading={progress !== null}
            onClick={() => input.current?.click()}
          >
            {shown ? 'Change photo' : 'Upload photo'}
          </Button>
          {shown && (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              leftIcon={<Trash2 size={14} />}
              onClick={() => {
                setPreview(null);
                onChange(currentUrl ? '' : undefined);
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <span className={styles.help}>
          {progress !== null ? `Uploading… ${progress}%` : value !== undefined ? 'Submit for review to apply it.' : 'JPG or PNG.'}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        aria-label="Profile photo"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
