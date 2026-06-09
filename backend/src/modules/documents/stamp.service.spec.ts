import { PDFDocument } from 'pdf-lib';
import { StampService } from './stamp.service';

// A 1×1 PNG (valid bytes) so pdf-lib's embedPng succeeds in the real-stamping path.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function makeOnePagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  return Buffer.from(await pdf.save());
}

describe('StampService (real pdf-lib; original never mutated)', () => {
  it('loads the original, stamps an image + text field, and uploads a NEW valid PDF', async () => {
    const original = await makeOnePagePdf();
    const storage = {
      download: jest.fn(async (path: string) => (path === 'orig.pdf' ? original : PNG_1x1)),
      uploadBuffer: jest.fn().mockResolvedValue({ path: 'documents/signed/x/2026/signed.pdf', stored: true }),
    };
    const stamp = new StampService(storage as never);

    const result = await stamp.stamp('orig.pdf', 'documents/signed/x', [
      { box: { page: 0, x: 0.1, y: 0.8, w: 0.25, h: 0.06 }, imagePath: 'sig.png' },
      { box: { page: 0, x: 0.1, y: 0.9, w: 0.3, h: 0.04 }, text: '2026-06-10' },
    ]);

    expect(result?.path).toBe('documents/signed/x/2026/signed.pdf');
    const out = storage.uploadBuffer.mock.calls[0][2] as Buffer;
    expect(out.subarray(0, 5).toString()).toBe('%PDF-'); // a real PDF was produced
    expect(out.length).toBeGreaterThan(0);
    // the original buffer object is never handed back / mutated
    expect(out).not.toBe(original);
  });

  it('returns null gracefully when the original is not downloadable (storage off)', async () => {
    const storage = { download: jest.fn().mockResolvedValue(null), uploadBuffer: jest.fn() };
    const stamp = new StampService(storage as never);
    const result = await stamp.stamp('local://documents/x.pdf', 'f', [{ box: { page: 0, x: 0, y: 0, w: 1, h: 0.1 }, text: 'x' }]);
    expect(result).toBeNull();
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
  });

  it('skips a field whose page does not exist (no throw)', async () => {
    const original = await makeOnePagePdf();
    const storage = {
      download: jest.fn().mockResolvedValue(original),
      uploadBuffer: jest.fn().mockResolvedValue({ path: 'p', stored: true }),
    };
    const stamp = new StampService(storage as never);
    const result = await stamp.stamp('orig.pdf', 'f', [{ box: { page: 9, x: 0, y: 0, w: 1, h: 0.1 }, text: 'x' }]);
    expect(result?.path).toBe('p'); // produced a copy, just didn't draw the out-of-range field
  });
});
