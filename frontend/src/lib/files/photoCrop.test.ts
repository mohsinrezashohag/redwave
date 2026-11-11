import { describe, expect, it, vi } from 'vitest';
import { clampOffset, displayScale, drawCrop, INITIAL_CROP, nextRotation, rotatedSize } from './photoCrop';

describe('photoCrop', () => {
  it('covers the viewport at zoom 1 by the SHORT side, and rotation swaps the sides', () => {
    expect(displayScale(1000, 500, 0, 250, 1)).toBe(0.5); // 500 tall → 250
    expect(rotatedSize(1000, 500, 90)).toEqual({ w: 500, h: 1000 });
    expect(displayScale(1000, 500, 90, 250, 2)).toBe(1);
  });

  it('never lets an empty edge show: the offset is clamped to the overflow', () => {
    // 1000×500 at 0.5 → 500×250 in a 250 viewport: 125 px spare each side horizontally, none vertically.
    expect(clampOffset({ ...INITIAL_CROP, dx: 400, dy: 50 }, 1000, 500, 250)).toMatchObject({ dx: 125, dy: 0 });
    expect(clampOffset({ ...INITIAL_CROP, dx: -400 }, 1000, 500, 250).dx).toBe(-125);
  });

  it('rotates in 90° steps and wraps', () => {
    expect(nextRotation(270)).toBe(0);
    expect(nextRotation(0)).toBe(90);
  });

  it('draws what the viewport shows, scaled to the output size', () => {
    const ctx = { translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
    drawCrop(ctx, {} as CanvasImageSource, 1000, 500, { zoom: 1, dx: 10, dy: 0, rotation: 0 }, 250, 500);
    expect(ctx.translate).toHaveBeenCalledWith(270, 250); // centre + 10 px × (500/250)
    expect(ctx.scale).toHaveBeenCalledWith(1, 1); // 0.5 display scale × 2
    expect(ctx.drawImage).toHaveBeenCalledWith({}, -500, -250, 1000, 500);
  });
});
