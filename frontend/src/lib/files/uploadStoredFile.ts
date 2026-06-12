/**
 * uploadStoredFile — the ONE client upload path to POST /v1/files (the unified pipeline). XHR-based
 * because fetch exposes no upload progress (design-system §6.3 requires a per-file bar). Carries the
 * bearer + the double-submit CSRF header + credentials, exactly like the multipartPost contract; parses
 * the error envelope into an ApiError so error toasts work uniformly. Returns the stored_files row —
 * the PATH is what consumers persist (downloads are minted per-domain, RBAC-gated).
 */
import type { components } from '../../api/generated/schema';
import { getAccessToken } from '../../api/auth-store';
import { getCsrfToken } from '../../auth/session';
import { ApiError } from '../api/apiError';

export type StoredFile = components['schemas']['StoredFileResponse'];
export type FilePurpose = 'receipt' | 'document';

export interface UploadOptions {
  file: File;
  purpose: FilePurpose;
  displayName?: string;
  /** 0..100 — upload progress (the request body only; server processing follows at 100). */
  onProgress?: (pct: number) => void;
}

export function uploadStoredFile({ file, purpose, displayName, onProgress }: UploadOptions): Promise<StoredFile> {
  const base = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  if (displayName) {
    form.append('display_name', displayName);
  }

  return new Promise<StoredFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/v1/files`);
    xhr.withCredentials = true; // session cookies ride along (the CSRF guard checks the pair)
    const token = getAccessToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    const csrf = getCsrfToken();
    if (csrf) {
      xhr.setRequestHeader('X-CSRF-Token', csrf);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as StoredFile);
        return;
      }
      const envelope = (body ?? {}) as { error?: { message?: string; details?: unknown } };
      reject(
        new ApiError(
          xhr.status,
          envelope.error?.message ??
            (xhr.status === 503 ? 'File storage is not configured on the server.' : `Upload failed (${xhr.status})`),
          envelope.error?.details,
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — check your connection and try again.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'Upload timed out — try again.'));
    xhr.send(form);
  });
}
