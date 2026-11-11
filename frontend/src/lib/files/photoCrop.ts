/**
 * photoCrop — PURE geometry for the square photo editor (2026-11-12). The image is shown in a square
 * VIEWPORT (circle-masked), scaled to COVER it at zoom 1, panned by an offset from the centre and rotated in
 * 90° steps. The same numbers draw the final square on a canvas, so what you see is what is saved.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface CropState {
  zoom: number; // 1 = cover, up to MAX_ZOOM
  dx: number; // image-centre offset from the viewport centre, in viewport px
  dy: number;
  rotation: Rotation;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const INITIAL_CROP: CropState = { zoom: 1, dx: 0, dy: 0, rotation: 0 };

/** Width/height of the image after rotation. */
export function rotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

/** Scale (viewport px per image px) so the rotated image covers the viewport, times the zoom. */
export function displayScale(w: number, h: number, rotation: Rotation, viewport: number, zoom: number): number {
  const r = rotatedSize(w, h, rotation);
  return (viewport / Math.min(r.w, r.h)) * zoom;
}

/** Keep the image covering the viewport: no empty edge may show. */
export function clampOffset(state: CropState, w: number, h: number, viewport: number): CropState {
  const s = displayScale(w, h, state.rotation, viewport, state.zoom);
  const r = rotatedSize(w, h, state.rotation);
  const maxX = Math.max(0, (r.w * s - viewport) / 2);
  const maxY = Math.max(0, (r.h * s - viewport) / 2);
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v));
  return { ...state, dx: clamp(state.dx, maxX), dy: clamp(state.dy, maxY) };
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Draw the cropped square onto a canvas context of size `out`×`out`. */
export function drawCrop(
  ctx: Pick<CanvasRenderingContext2D, 'translate' | 'rotate' | 'scale' | 'drawImage'>,
  image: CanvasImageSource,
  w: number,
  h: number,
  state: CropState,
  viewport: number,
  out: number,
): void {
  const k = out / viewport;
  const s = displayScale(w, h, state.rotation, viewport, state.zoom);
  ctx.translate(out / 2 + state.dx * k, out / 2 + state.dy * k);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.scale(s * k, s * k);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
}
