import { describe, expect, it } from 'vitest';
import { isPassthrough, MAX_LONG_EDGE, targetDimensions } from './compressImage';

describe('targetDimensions — max 2000px long edge, aspect preserved, never upscaled', () => {
  it('downscales a landscape photo by its WIDTH (the long edge)', () => {
    expect(targetDimensions(4000, 3000)).toEqual({ width: 2000, height: 1500 });
  });

  it('downscales a portrait photo by its HEIGHT (the long edge)', () => {
    expect(targetDimensions(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });

  it('leaves images at or under the cap untouched (never upscales)', () => {
    expect(targetDimensions(2000, 1200)).toEqual({ width: 2000, height: 1200 });
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('handles extreme aspect ratios without collapsing a dimension to 0', () => {
    const { width, height } = targetDimensions(10000, 10);
    expect(width).toBe(MAX_LONG_EDGE);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('zero-size input passes through (no division blow-up)', () => {
    expect(targetDimensions(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('isPassthrough — PDFs are never re-encoded', () => {
  it('passes PDFs through and compresses images', () => {
    expect(isPassthrough(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(isPassthrough(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
    expect(isPassthrough(new File(['x'], 'a.heic', { type: 'image/heic' }))).toBe(false);
  });
});
