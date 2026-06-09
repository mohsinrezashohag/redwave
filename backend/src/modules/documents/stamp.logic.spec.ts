import { fitContain, textSizeForBox, toPdfRect } from './stamp.logic';

describe('stamp.logic — coordinate transform (top-left fraction → pdf-lib points)', () => {
  const page = { width: 600, height: 800 };

  it('flips the origin: a top-left box becomes a bottom-left rect', () => {
    // a box at the very top-left, 100% wide × 10% tall
    const rect = toPdfRect({ page: 0, x: 0, y: 0, w: 1, h: 0.1 }, page);
    expect(rect).toEqual({ x: 0, y: 720, width: 600, height: 80 }); // y = 800 - 0 - 80
  });

  it('places a field near the bottom of the page correctly', () => {
    // a box 80% down, 25% wide × 6% tall, 10% from the left
    const rect = toPdfRect({ page: 0, x: 0.1, y: 0.8, w: 0.25, h: 0.06 }, page);
    expect(rect.x).toBeCloseTo(60); // 0.1 * 600
    expect(rect.width).toBeCloseTo(150); // 0.25 * 600
    expect(rect.height).toBeCloseTo(48); // 0.06 * 800
    // top is 0.8*800 = 640 from the top → y = 800 - 640 - 48 = 112
    expect(rect.y).toBeCloseTo(112);
  });

  it('fitContain preserves aspect ratio and centers within the box', () => {
    const rect = { x: 0, y: 0, width: 200, height: 100 };
    // a wide 400×100 image → scale 0.5 → 200×50, centered vertically (y = 25)
    const drawn = fitContain(400, 100, rect);
    expect(drawn.width).toBeCloseTo(200);
    expect(drawn.height).toBeCloseTo(50);
    expect(drawn.x).toBeCloseTo(0);
    expect(drawn.y).toBeCloseTo(25);
  });

  it('fitContain guards against zero dimensions', () => {
    const rect = { x: 5, y: 5, width: 0, height: 10 };
    expect(fitContain(100, 50, rect)).toMatchObject({ x: 5, y: 5, width: 0 });
  });

  it('textSizeForBox clamps to a readable range', () => {
    expect(textSizeForBox({ x: 0, y: 0, width: 100, height: 100 })).toBe(14); // clamped to max
    expect(textSizeForBox({ x: 0, y: 0, width: 100, height: 4 })).toBe(6); // clamped to min
  });
});
