/**
 * stored-files.logic — PURE rules for the unified upload pipeline (no I/O, no Nest): the mime allowlist,
 * the size cap, and the SERVER-generated object path. The path is never client-supplied and never derived
 * from the client filename: "{purpose}s/{yyyy}/{mm}/{uuid}.{ext}" with the extension taken from the
 * VALIDATED mime — so a stored path can never carry path traversal, collisions, or a spoofed extension.
 * — arch §11 / security.md (file storage)
 */

export const FILE_PURPOSES = ['receipt', 'document'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** Allowed upload mimes. The FE compresses images to JPEG first; PDFs pass through. */
export const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export function isAllowedMime(mime: string): boolean {
  return (ALLOWED_MIMES as readonly string[]).includes(mime);
}

/** The storage extension for a VALIDATED mime (call isAllowedMime first). */
export function extForMime(mime: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    throw new Error(`no extension mapping for mime '${mime}'`); // server fault — the allowlist gate failed
  }
  return ext;
}

/** The claim prefix a purpose's paths must carry ("receipts/", "documents/"). */
export function purposePrefix(purpose: FilePurpose): string {
  return `${purpose}s/`;
}

/**
 * Build the server-generated object path: "{purpose}s/{yyyy}/{mm}/{uuid}.{ext}". `now` and `uuid` are
 * injected for determinism in tests; the month is zero-padded (UTC).
 */
export function buildObjectPath(purpose: FilePurpose, mime: string, now: Date, uuid: string): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${purposePrefix(purpose)}${yyyy}/${mm}/${uuid}.${extForMime(mime)}`;
}
