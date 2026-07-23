/**
 * exportRows — turn a list (columns + rows) into a downloaded CSV / Excel / PDF. CSV is hand-rolled (no
 * dep); Excel (`write-excel-file`) and PDF (`jspdf` + `jspdf-autotable`) are DYNAMICALLY imported so the
 * libs only load when the user actually exports — never on first paint. Cell values are produced as
 * STRINGS by the caller (money stays an exact decimal string, #1 — no float coercion here).
 */
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportColumn<Row> {
  header: string;
  value: (row: Row) => string;
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
    const dataRows: XlsxCell[][] = matrix.map((line) => line.map((cell) => ({ value: cell, type: String })));
    await writeXlsxFile([headerRow, ...dataRows]).toFile(`${filename}.xlsx`);
    return;
  }

  // pdf
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: matrix.length && columns.length > 6 ? 'landscape' : 'portrait' });
  if (title) doc.text(title, 14, 16);
  autoTable(doc, {
    head: [headers],
    body: matrix,
    startY: title ? 22 : 14,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [19, 33, 61] }, // brand navy
  });
  doc.save(`${filename}.pdf`);
}
