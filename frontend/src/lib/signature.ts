/**
 * Signature image helpers — convert a canvas data-URL to a File (for multipart upload) and render a typed
 * name to a PNG data-URL. The ink is dark because signatures are stamped onto a white PDF page. — SRS §13
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

/** Render a typed name to a transparent PNG data-URL in a script-style font. */
export function typedSignatureDataUrl(text: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#111111'; // dark ink for a white PDF page
  ctx.font = '64px "Segoe Script", "Brush Script MT", cursive';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, canvas.height / 2);
  return canvas.toDataURL('image/png');
}
