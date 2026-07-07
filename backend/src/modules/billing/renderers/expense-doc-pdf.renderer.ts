/**
 * ExpenseDocPdfRenderer — renders the per-client EXPENSE billing document to a real PDF (pdf-lib).
 * Kilometres + food ONLY, grouped by type, itemized per rep per day, in the client's currency, with the
 * frozen CAD equivalent for a foreign document (#12). NO receipts, NO commission data (#3), NO GST.
 * Renders from the FROZEN `line_detail` snapshot (stable re-download). — SRS BILL-012 / EXP-014
 */
import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { expenseDocNo } from '../doc-number';

export interface ExpenseDocLineForExport {
  type: 'km' | 'meals';
  rep_name: string;
  date: string;
  description: string;
  amount: string;
}

export interface ExpenseDocForExport {
  document_number: number | null;
  client_name: string;
  client_code: string;
  period_number: number;
  period_start: string;
  period_end: string;
  generated_at: string;
  currency: string; // the document's billing currency (#12)
  amount_cad: string | null; // frozen CAD equivalent (null on a CAD document)
  total_amount: string;
  lines: ExpenseDocLineForExport[];
}

const SECTION_TITLE: Record<'km' | 'meals', string> = { km: 'Kilometres', meals: 'Food' };
const navy = rgb(0.07, 0.13, 0.24);
const ink = rgb(0.1, 0.1, 0.1);
const muted = rgb(0.4, 0.4, 0.4);

@Injectable()
export class ExpenseDocPdfRenderer {
  async render(doc: ExpenseDocForExport): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const left = 56;

    let page = pdf.addPage([612, 792]); // US Letter
    let y = 740;
    const newPageIfNeeded = () => {
      if (y < 80) {
        page = pdf.addPage([612, 792]);
        y = 740;
      }
    };
    const text = (s: string, x: number, size: number, f: PDFFont, color = ink) => page.drawText(s, { x, y, size, font: f, color });
    const row = (label: string, amount: string, f: PDFFont, color = ink) => {
      text(label, left + 8, 10, f, color);
      text(`${doc.currency} ${amount}`, left + 380, 10, f, color);
      y -= 18;
      newPageIfNeeded();
    };

    // Header
    text('Redwave Marketing Inc.', left, 18, bold, navy);
    y -= 24;
    text('Client Expense Billing Document', left, 13, bold, navy);
    y -= 22;
    text(expenseDocNo(doc.document_number), left, 12, bold, ink);
    y -= 18;
    text(`Client: ${doc.client_name} (${doc.client_code})`, left, 11, font);
    y -= 16;
    text(`Pay period ${doc.period_number}: ${doc.period_start} to ${doc.period_end}`, left, 11, font);
    y -= 16;
    text(`Generated: ${doc.generated_at.slice(0, 10)}`, left, 11, font);
    y -= 28;

    // Grouped sections (km then meals — lines arrive pre-sorted by type → rep → date).
    let currentType: 'km' | 'meals' | null = null;
    let sectionSubtotal = 0;
    const flushSubtotal = () => {
      if (currentType !== null) {
        row(`${SECTION_TITLE[currentType]} subtotal`, sectionSubtotal.toFixed(2), bold, navy);
        y -= 8;
      }
    };
    for (const line of doc.lines) {
      if (line.type !== currentType) {
        flushSubtotal();
        currentType = line.type;
        sectionSubtotal = 0;
        text(SECTION_TITLE[line.type], left, 12, bold, navy);
        y -= 18;
        newPageIfNeeded();
      }
      row(`${line.date}  ·  ${line.rep_name}  ·  ${line.description}`, line.amount, font);
      sectionSubtotal += Number(line.amount);
    }
    flushSubtotal();

    if (doc.lines.length === 0) {
      text('No billable kilometres or food for the selected reps/days.', left, 11, font, muted);
      y -= 18;
    }

    // Grand total + frozen CAD equivalent for a foreign document.
    y -= 6;
    page.drawRectangle({ x: left, y: y - 8, width: 500, height: 26, color: rgb(0.96, 0.97, 0.99) });
    text('Total', left + 8, 12, bold, navy);
    text(`${doc.currency} ${doc.total_amount}`, left + 380, 12, bold, navy);
    y -= 30;
    if (doc.currency !== 'CAD' && doc.amount_cad) {
      text(`CAD equivalent: CAD ${doc.amount_cad}`, left + 8, 11, bold, navy);
      y -= 18;
    }
    text(`All amounts in ${doc.currency}. Kilometres + food only — no receipts, no commission, no GST.`, left, 9, font, muted);

    return Buffer.from(await pdf.save());
  }
}
