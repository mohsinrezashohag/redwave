/**
 * stamp.logic — PURE coordinate maths for stamping signature fields onto a PDF. Fields are stored as
 * normalized fractions 0..1 of the page with a TOP-LEFT origin (matching pdf.js / CSS, where the UI
 * placed them); pdf-lib draws in PDF points with a BOTTOM-LEFT origin. This module converts between the
 * two and fits an image inside a field box preserving aspect ratio. No I/O — unit-tested in isolation so a
 * misplaced stamp can never ship silently. — SRS DOC-003/004
 */

export interface PageSize {
  width: number;
  height: number;
}

/** A field's normalized box: fractions 0..1 of the page, TOP-LEFT origin. */
export interface NormBox {
  page: number;
  x: number; // left
  y: number; // top
  w: number;
  h: number;
}

/** A rectangle in pdf-lib points, BOTTOM-LEFT origin (what page.drawImage/drawText expect). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert a normalized top-left field box to pdf-lib bottom-left points for a given page size. */
export function toPdfRect(box: NormBox, page: PageSize): PdfRect {
  const width = box.w * page.width;
  const height = box.h * page.height;
  const x = box.x * page.width;
  const yFromTop = box.y * page.height;
  const y = page.height - yFromTop - height; // flip the origin to bottom-left
  return { x, y, width, height };
}

/**
 * Fit a `srcW × srcH` image inside `rect` preserving aspect ratio, centered. Returns the draw rectangle
 * (pdf-lib points). Guards against zero/negative dimensions.
 */
export function fitContain(srcW: number, srcH: number, rect: PdfRect): PdfRect {
  if (srcW <= 0 || srcH <= 0 || rect.width <= 0 || rect.height <= 0) {
    return { x: rect.x, y: rect.y, width: Math.max(rect.width, 0), height: Math.max(rect.height, 0) };
  }
  const scale = Math.min(rect.width / srcW, rect.height / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  const x = rect.x + (rect.width - width) / 2;
  const y = rect.y + (rect.height - height) / 2;
  return { x, y, width, height };
}

/** A reasonable font size to fit text within a field's height (centered vertically by the caller). */
export function textSizeForBox(rect: PdfRect, max = 14): number {
  return Math.max(6, Math.min(max, rect.height * 0.6));
}
