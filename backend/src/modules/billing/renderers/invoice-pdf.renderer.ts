/**
 * InvoicePdfRenderer — renders the one-line COMMISSION INVOICE to a real PDF (pdf-lib). One amount
 * (`total_commission` = the billing-stream statement total, #3), single-currency **CAD**, **NO GST/tax**.
 * — SRS BILL-003
 */
import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { invoiceNo } from '../doc-number';

export interface InvoiceForExport {
  invoice_number: number | null;
  client_name: string;
  client_code: string;
  period_number: number;
  period_start: string;
  period_end: string;
  /** true → a billing week ("Bill 17"); false → a legacy pay-period invoice. */
  is_billing_week: boolean;
  generated_at: string;
  currency: string; // the document's billing currency (#12)
  amount_cad: string | null; // frozen CAD equivalent (null on legacy rows)
  total_commission: string;
}

@Injectable()
export class InvoicePdfRenderer {
  async render(inv: InvoiceForExport): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]); // US Letter
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0.07, 0.13, 0.24);
    const ink = rgb(0.1, 0.1, 0.1);
    let y = 740;
    const left = 56;
    const line = (text: string, size = 11, f = font, color = ink) => {
      page.drawText(text, { x: left, y, size, font: f, color });
      y -= size + 8;
    };

    line('Redwave Marketing Inc.', 18, bold, navy);
    line('Commission Invoice', 13, bold, navy);
    y -= 6;
    line(invoiceNo(inv.invoice_number), 12, bold);
    line(`Client: ${inv.client_name} (${inv.client_code})`);
    line(
      inv.is_billing_week
        ? `Bill ${inv.period_number}: ${inv.period_start} to ${inv.period_end}`
        : `Pay period ${inv.period_number}: ${inv.period_start} to ${inv.period_end}`,
    );
    line(`Generated: ${inv.generated_at.slice(0, 10)}`);
    y -= 18;

    // The single commission amount — no tax.
    page.drawRectangle({ x: left, y: y - 30, width: 500, height: 40, color: rgb(0.96, 0.97, 0.99) });
    page.drawText('Total commission', { x: left + 12, y: y - 14, size: 12, font: bold, color: navy });
    page.drawText(`${inv.currency} ${inv.total_commission}`, { x: left + 360, y: y - 14, size: 12, font: bold, color: navy });
    y -= 64;
    // For a foreign invoice show the frozen CAD equivalent (reconciliation figure, #12).
    if (inv.currency !== 'CAD' && inv.amount_cad) {
      line(`CAD equivalent: CAD ${inv.amount_cad}`, 11, bold, navy);
      y -= 4;
    }
    line(`All amounts in ${inv.currency}. No GST/PST (tax handled in QuickBooks).`, 9, font, rgb(0.4, 0.4, 0.4));

    return Buffer.from(await pdf.save());
  }
}
