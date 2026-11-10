/**
 * downloadFile — fetch a streamed file endpoint (Excel / PDF / CSV) and save it. openapi-fetch is for JSON,
 * so binary downloads use a raw fetch with the bearer + CSRF header + credentials (same as multipartUpload).
 * Parses the contract error envelope into an ApiError so callers' error toasts work uniformly. — arch §6.9
 */
import { getAccessToken } from '../../api/auth-store';
import { getCsrfToken } from '../../auth/session';
import { ApiError } from './apiError';

interface DownloadOptions {
  method?: 'GET' | 'POST';
  /** JSON body (POST exports, e.g. { format }). */
  body?: unknown;
  /** Override the filename; otherwise taken from Content-Disposition, else a fallback. */
  filename?: string;
}

export async function downloadFile(path: string, opts: DownloadOptions = {}): Promise<void> {
  const base = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    let details: unknown;
    try {
      const errBody = (await res.json()) as { error?: { message?: string; details?: unknown } };
      message = errBody.error?.message ?? message;
      details = errBody.error?.details;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, details);
  }

  const blob = await res.blob();
  const filename = opts.filename ?? filenameFromDisposition(res.headers.get('content-disposition')) ?? 'download';
  triggerSave(blob, filename);
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Save a Blob the page already holds (e.g. file content returned in a JSON response) as a download. */
export function triggerSave(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
