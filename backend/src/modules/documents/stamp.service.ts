/**
 * StampService — server-side PDF stamping with pdf-lib. Given the ORIGINAL document's object path and a
 * list of field boxes (each carrying either an image path or text), it loads the original, draws each
 * field at its (pure-computed) position, and uploads the result as a NEW object — the original is never
 * mutated (DOC-001/004). Returns null when storage is unconfigured / the original isn't downloadable
 * (graceful: the signature event is still recorded, just without a stamped copy). — SRS DOC-004/005
 */
import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFImage, StandardFonts, rgb } from 'pdf-lib';
import { StorageService, StoredObject } from '../../common/storage/storage.service';
import { fitContain, textSizeForBox, toPdfRect, type NormBox } from './stamp.logic';

/** One thing to stamp: a field box + either an image (signature/initial) or text (date/text). */
export interface StampItem {
  box: NormBox;
  imagePath?: string | null;
  text?: string | null;
}

@Injectable()
export class StampService {
  private readonly logger = new Logger(StampService.name);

  constructor(private readonly storage: StorageService) {}

  /** Stamp `items` onto a copy of the original PDF and store it under `folder`. Null = graceful no-op. */
  async stamp(originalPath: string, folder: string, items: StampItem[]): Promise<StoredObject | null> {
    const originalBytes = await this.storage.download(originalPath);
    if (!originalBytes) {
      return null; // storage off / original not retrievable — record the event without a stamped copy
    }
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(originalBytes);
    } catch (err) {
      this.logger.error(`Failed to load PDF ${originalPath}: ${(err as Error).message}`);
      return null;
    }
    const pages = pdf.getPages();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    for (const item of items) {
      const page = pages[item.box.page];
      if (!page) continue;
      const rect = toPdfRect(item.box, { width: page.getWidth(), height: page.getHeight() });

      if (item.imagePath) {
        const imgBytes = await this.storage.download(item.imagePath);
        if (!imgBytes) continue;
        const img = await this.embed(pdf, imgBytes);
        if (!img) continue;
        const draw = fitContain(img.width, img.height, rect);
        page.drawImage(img, draw);
      } else if (item.text) {
        const size = textSizeForBox(rect);
        page.drawText(item.text, {
          x: rect.x + 2,
          y: rect.y + (rect.height - size) / 2,
          size,
          font,
          color: rgb(0.1, 0.1, 0.45),
        });
      }
    }

    const out = Buffer.from(await pdf.save());
    return this.storage.uploadBuffer(folder, 'signed.pdf', out, 'application/pdf');
  }

  /** Embed a PNG or JPEG (best-effort); null if the bytes are neither. */
  private async embed(pdf: PDFDocument, bytes: Buffer): Promise<PDFImage | null> {
    try {
      return await pdf.embedPng(bytes);
    } catch {
      /* not a PNG — try JPEG */
    }
    try {
      return await pdf.embedJpg(bytes);
    } catch {
      this.logger.warn('signature image is neither PNG nor JPEG — skipped');
      return null;
    }
  }
}
