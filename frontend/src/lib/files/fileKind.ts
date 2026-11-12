/**
 * What kind of file a stored-file URL points at, from the file name in its path (signed URLs keep the
 * object name, e.g. `…/rep-docs/2026/abc-passport.pdf?token=…`). Decides how the preview dialog shows it.
 */
export type FileKind = 'pdf' | 'image' | 'other';

export function fileKindFromUrl(url: string): FileKind {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const ext = decodeURIComponent(path).split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  return 'other';
}
