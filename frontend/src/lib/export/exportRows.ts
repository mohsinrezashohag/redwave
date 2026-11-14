/**
 * exportRows — turn a list (columns + rows) into a downloaded CSV / Excel / PDF. CSV is hand-rolled (no
 * dep); Excel (`write-excel-file`) and PDF (`jspdf` + `jspdf-autotable`) are DYNAMICALLY imported so the
 * libs only load when the user actually exports — never on first paint. Cell values are produced as
 * STRINGS by the caller (money stays an exact decimal string, #1). Only the Excel writer turns a `money`
 * column into a numeric cell, as the spreadsheet's output format (so Redwave can total it there).
 */
import { money } from '../format/money';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportColumn<Row> {
  header: string;
  value: (row: Row) => string;
  /**
   * A money column whose `value` is the server's plain decimal string ('145.00', or '' when blank). CSV and
   * Excel then carry a real number Excel can sum (Excel gets a numeric cell, 2 dp); the PDF shows it as
   * money ('$145.00'). The UI never computes with it: it is only the OUTPUT format of a server amount (#1).
   */
  money?: boolean;
  /** false = left out of the PDF only (a wide detail column a printed page has no room for). */
  pdf?: boolean;
}

export interface ExportOptions<Row> {
  format: ExportFormat;
  /** File name WITHOUT extension. */
  filename: string;
  columns: ExportColumn<Row>[];
  rows: Row[];
  /** Optional document title (PDF only). */
  title?: string;
}

/** Above this many columns a PDF switches to A3 landscape so rows stay on one line. */
const WIDE_TABLE_COLUMNS = 12;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** RFC-4180-ish CSV cell: quote when it contains a comma, quote, or newline; double embedded quotes. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportRows<Row>({ format, filename, columns, rows, title }: ExportOptions<Row>): Promise<void> {
  const headers = columns.map((c) => c.header);
  const matrix = rows.map((row) => columns.map((c) => c.value(row)));
  const isMoney = columns.map((c) => c.money === true);

  if (format === 'csv') {
    const lines = [headers, ...matrix].map((line) => line.map(csvCell).join(','));
    // Prepend a BOM so Excel opens UTF-8 correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${filename}.csv`);
    return;
  }

  if (format === 'xlsx') {
    // write-excel-file (browser, matrix mode). v4 REMOVED the `fileName` option: the call now returns
    // `{ toBlob, toFile }` and downloads ONLY via `.toFile(name)`. Passing `{ fileName }` and awaiting the
    // result is a silent no-op — no file, no error. The cast is narrowed to just the matrix argument so
    // the real return type still applies and a future breaking change fails the build instead of the user.
    type XlsxCell = { value: string; type?: unknown; fontWeight?: 'bold' };
    const writeXlsxFile = (await import('write-excel-file/browser')).default as unknown as (
      data: XlsxCell[][],
    ) => { toFile: (fileName: string) => Promise<void> };
    const headerRow: XlsxCell[] = headers.map((h) => ({ value: h, fontWeight: 'bold' }));
    // A money cell goes to Excel as a NUMBER (2 dp) so Redwave can total it; blank stays blank. This is the
    // spreadsheet's output format of a server amount, never arithmetic in the app (#1).
    const dataRows: XlsxCell[][] = matrix.map((line) =>
      line.map((cell, i) =>
        isMoney[i] && cell !== ''
          ? ({ value: Number(cell), type: Number, format: '#,##0.00' } as unknown as XlsxCell)
          : { value: cell, type: String },
      ),
    );
    await writeXlsxFile([headerRow, ...dataRows]).toFile(`${filename}.xlsx`);
    return;
  }

  // pdf
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  // A wide table (the 18-column sales export) on A4 wrapped names, dates and codes over several lines and
  // tripled the page count; it moves to A3 landscape at a smaller size instead. Narrow tables are unchanged.
  // Detail columns marked `pdf: false` stay in CSV/Excel but are left off a printed page.
  const keep = columns.map((c) => c.pdf !== false);
  const pdfHeaders = headers.filter((_, i) => keep[i]);
  const pdfMatrix = matrix.map((line) =>
    line.flatMap((cell, i) => (keep[i] ? [isMoney[i] && cell !== '' ? money(cell) : cell] : [])),
  );
  const wide = pdfHeaders.length > WIDE_TABLE_COLUMNS;
  const doc = new jsPDF({
    orientation: pdfMatrix.length && pdfHeaders.length > 6 ? 'landscape' : 'portrait',
    format: wide ? 'a3' : 'a4',
  });
  if (title) doc.text(title, 14, 16);
  autoTable(doc, {
    head: [pdfHeaders],
    body: pdfMatrix,
    startY: title ? 22 : 14,
    styles: wide ? { fontSize: 7, cellPadding: 1.5 } : { fontSize: 8 },
    headStyles: { fillColor: [19, 33, 61] }, // brand navy
    rowPageBreak: 'avoid', // a record is never split across two pages
  });
  doc.save(`${filename}.pdf`);
}
