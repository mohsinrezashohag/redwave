/**
 * compressImage — automatic in-browser image compression before upload (design-system §6.3).
 * Images decode via `createImageBitmap` (covers HEIC on iOS Safari, where the OS decodes natively),
 * downscale to a max 2000px long edge, and re-encode as JPEG quality 0.8 via canvas.toBlob — so a 12 MP
 * phone photo lands well under the server's 10 MB cap and as an ALLOWED mime. PDFs pass through
 * untouched. The ORIGINAL filename is kept (the server stores it as original_name and never uses it for
 * the storage path). If decoding fails (unsupported codec on this browser), the original file is uploaded
 * as-is — the server's mime allowlist is the real gate.
 */

export const MAX_LONG_EDGE = 2000;
export const JPEG_QUALITY = 0.8;

/** Downscale (never upscale) so the LONG edge is at most `max`, preserving aspect ratio. Pure. */
export function targetDimensions(width: number, height: number, max: number = MAX_LONG_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long === 0) {
    return { width, height };
  }
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** True for files the compressor should leave untouched (PDFs pass through). */
export function isPassthrough(file: File): boolean {
  return file.type === 'application/pdf';
}

/**
 * Prepare a file for upload: PDFs pass through; images are downscaled + re-encoded to JPEG. Falls back to
 * the original file when the browser can't decode it (the server allowlist then decides).
 */
export async function prepareForUpload(file: File): Promise<File> {
  if (isPassthrough(file)) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = targetDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) {
      return file;
    }
    // Keep the ORIGINAL name — the server records it as original_name (the path is server-generated).
    return new File([blob], file.name, { type: 'image/jpeg' });
  } catch {
    return file; // undecodable here (e.g. HEIC on a non-Safari browser) — let the server allowlist decide
  }
}
