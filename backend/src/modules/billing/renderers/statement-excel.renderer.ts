/**
 * StatementExcelRenderer — renders a client statement to a real .xlsx (exceljs), recreating the Excel
 * Redwave sends clients: a header block, then ONE ROW PER CUSTOMER (combined product total), then the grand
 * total. Single-currency **CAD**, **NO GST/tax**. The financial values are the frozen, exact 2-dp figures.
 * NOTE: this is a faithful GENERIC layout — refine against Redwave's real client template (like the import
 * templates). — SRS BILL-002
 */
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { statementNo } from '../doc-number';

export interface StatementForExport {
  statement_number: number | null;
  client_name: string;
  client_code: string;
  period_number: number;
  period_start: string; // 'YYYY-MM-DD'
  period_end: string; // 'YYYY-MM-DD'
  generated_at: string;
  currency: string; // the document's billing currency (#12)
  amount_cad: string | null; // frozen CAD equivalent (null on legacy rows)
  lines: { customer_name: string; products_summary: string; line_total: string }[];
  total_amount: string;
}

@Injectable()
export class StatementExcelRenderer {
  async render(s: StatementForExport): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Redwave Marketing Inc.';
    const ws = wb.addWorksheet('Statement');
    ws.columns = [{ width: 30 }, { width: 36 }, { width: 16 }];

    ws.addRow(['Redwave Marketing Inc.']).font = { bold: true, size: 14 };
    ws.addRow(['Client Statement']).font = { bold: true };
    ws.addRow([statementNo(s.statement_number)]);
    ws.addRow([`Client: ${s.client_name} (${s.client_code})`]);
    ws.addRow([`Pay period ${s.period_number}: ${s.period_start} → ${s.period_end}`]);
    ws.addRow([`Currency: ${s.currency}`]);
    ws.addRow([]);

    const header = ws.addRow(['Customer', 'Products', `Amount (${s.currency})`]);
    header.font = { bold: true };
    header.eachCell((c) => {
      c.border = { bottom: { style: 'thin' } };
    });

    for (const l of s.lines) {
      // Amount as a real number for client-side summing in Excel — the value is the exact 2-dp figure
      // (presentation only; no JS float math on money). One line per customer (combined product total).
      const row = ws.addRow([l.customer_name, l.products_summary, Number(l.line_total)]);
      row.getCell(3).numFmt = '#,##0.00';
    }

    ws.addRow([]);
    const total = ws.addRow(['', `TOTAL (${s.currency})`, Number(s.total_amount)]);
    total.font = { bold: true };
    total.getCell(3).numFmt = '#,##0.00';

    // For a foreign document show the frozen CAD equivalent (reconciliation figure, #12).
    if (s.currency !== 'CAD' && s.amount_cad) {
      const cad = ws.addRow(['', 'CAD equivalent', Number(s.amount_cad)]);
      cad.getCell(3).numFmt = '#,##0.00';
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
