/**
 * FileUpload — design-system §6.3. Drag-and-drop zone + browse button; shows accepted types/size and a
 * per-file list with remove. Optionally renders REAL upload state per file — progress bar, error +
 * retry, and an image thumbnail — via the controlled `uploads` prop (features own the actual upload;
 * this presents it). `capture` forwards to the input so mobile browsers offer the camera. Tokens only.
 */
import { File as FileIcon, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import styles from './FileUpload.module.css';

/** Controlled per-file upload state (keyed by file name) — drives the progress/error/retry presentation. */
export interface FileUploadState {
  status: 'uploading' | 'done' | 'error';
  /** 0..100 while uploading. */
  progress?: number;
  error?: string;
  /** Object URL for an image preview chip. The caller owns the URL lifecycle. */
  thumbnailUrl?: string;
}

export interface FileUploadProps {
  accept?: string;
  multiple?: boolean;
  hint?: string;
  onFiles?: (files: File[]) => void;
  /** Per-file upload state keyed by `file.name` (controlled; optional — selection-only without it). */
  uploads?: Record<string, FileUploadState>;
  /** Re-attempt a failed upload (renders the retry affordance on error rows). */
  onRetry?: (file: File) => void;
  /** Forwarded to the input (e.g. "environment") so mobile browsers offer the camera. */
  capture?: 'user' | 'environment';
}

export function FileUpload({
  accept,
  multiple = true,
  hint = 'PDF, JPG or PNG — up to 10 MB',
  onFiles,
  uploads,
  onRetry,
  capture,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = multiple ? [...files, ...Array.from(list)] : Array.from(list).slice(0, 1);
    setFiles(next);
    onFiles?.(next);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  const remove = (i: number) => {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    onFiles?.(next);
  };

  return (
    <div>
      <div
        className={cx(styles.zone, dragging && styles.dragging)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <UploadCloud size={24} className={styles.zoneIcon} aria-hidden />
        <p className={styles.zoneTitle}>
          Drag files here or <span className={styles.browse}>browse</span>
        </p>
        <p className={styles.hint}>{hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          capture={capture}
          className={styles.input}
          onChange={(e) => add(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className={styles.list} role="list">
          {files.map((f, i) => {
            const state = uploads?.[f.name];
            return (
              <li className={styles.fileRow} key={`${f.name}-${i}`}>
                <div className={styles.fileLine}>
                  {state?.thumbnailUrl ? (
                    <img src={state.thumbnailUrl} alt="" className={styles.thumb} />
                  ) : (
                    <FileIcon size={16} className={styles.fileIcon} aria-hidden />
                  )}
                  <span className={styles.fileName}>{f.name}</span>
                  <span className={cx(styles.fileSize, 'mono')}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                  {state?.status === 'error' && onRetry && (
                    <IconButton label={`Retry ${f.name}`} icon={<RotateCcw size={15} />} size="sm" onClick={() => onRetry(f)} />
                  )}
                  <IconButton
                    label={`Remove ${f.name}`}
                    icon={<X size={15} />}
                    size="sm"
                    disabled={state?.status === 'uploading'}
                    onClick={() => remove(i)}
                  />
                </div>
                {state?.status === 'uploading' && (
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={state.progress ?? 0}
                    aria-label={`Uploading ${f.name}`}
                  >
                    <div className={styles.progressFill} style={{ width: `${state.progress ?? 0}%` }} />
                  </div>
                )}
                {state?.status === 'error' && <p className={styles.fileError}>{state.error ?? 'Upload failed.'}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
