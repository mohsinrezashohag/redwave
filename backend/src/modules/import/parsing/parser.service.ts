/**
 * ParserService — turns an uploaded Excel/CSV/TSV file into `{ headers, rows }` of raw cell values. Excel
 * (.xlsx/.xls) via **exceljs** (maintained, no critical parse-side CVEs); CSV/TSV via **papaparse**. For
 * Excel: the first non-empty worksheet, the first non-empty row as headers, subsequent rows as objects
 * keyed by header. A malformed/empty file → a clean 422 (never a crash/500). — SRS §15 IMP-003/011
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { UploadedFile } from '../../../common/storage/storage.service';
import { RawRow } from '../mapping.logic';

export interface ParseResult {
  sheet: string | null;
  headers: string[];
  rows: RawRow[];
}

@Injectable()
export class ParserService {
  async parse(file: UploadedFile): Promise<ParseResult> {
    const name = file.originalname.toLowerCase();
    const isCsv = name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.mimetype.includes('csv');
    const result = isCsv ? this.parseDelimited(file) : await this.parseExcel(file);
    if (result.headers.length === 0) {
      throw new UnprocessableEntityException('the file has no header row');
    }
    if (result.rows.length === 0) {
      throw new UnprocessableEntityException('the file has no data rows');
    }
    return result;
  }

  private parseDelimited(file: UploadedFile): ParseResult {
    const raw = file.buffer.toString('utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip a UTF-8 BOM if present
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      delimiter: file.originalname.toLowerCase().endsWith('.tsv') ? '\t' : '',
    });
    const headers = (parsed.meta.fields ?? []).filter((h) => h && h.trim() !== '');
    const rows = (parsed.data as RawRow[]).filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
    return { sheet: null, headers, rows };
  }

  private async parseExcel(file: UploadedFile): Promise<ParseResult> {
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs accepts a Node Buffer; cast through unknown to satisfy its ArrayBuffer-typed signature.
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new UnprocessableEntityException('could not read the Excel file (is it a valid .xlsx?)');
    }
    // Pick the first worksheet that has any data.
    const ws = wb.worksheets.find((w) => w.rowCount > 0 && w.actualColumnCount > 0);
    if (!ws) {
      throw new UnprocessableEntityException('the workbook has no data');
    }

    // Header row = the first row with ≥1 non-empty cell.
    let headerRowNumber = 0;
    ws.eachRow((row, n) => {
      if (headerRowNumber === 0 && row.values && (row.values as unknown[]).some((v) => v !== null && v !== undefined && String(v).trim() !== '')) {
        headerRowNumber = n;
      }
    });
    if (headerRowNumber === 0) {
      return { sheet: ws.name, headers: [], rows: [] };
    }

    const headerRow = ws.getRow(headerRowNumber);
    const headers: string[] = [];
    const colByIndex = new Map<number, string>();
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const h = cellText(cell.value).trim();
      if (h !== '') {
        headers.push(h);
        colByIndex.set(col, h);
      }
    });

    const rows: RawRow[] = [];
    ws.eachRow((row, n) => {
      if (n <= headerRowNumber) return;
      const obj: RawRow = {};
      let hasValue = false;
      colByIndex.forEach((header, col) => {
        const raw = row.getCell(col).value;
        const value = cellValue(raw);
        obj[header] = value;
        if (value !== null && value !== undefined && String(value).trim() !== '') hasValue = true;
      });
      if (hasValue) rows.push(obj);
    });

    return { sheet: ws.name, headers, rows };
  }
}

/** Flatten an exceljs cell value to text (for headers). */
function cellText(value: ExcelJS.CellValue): string {
  return String(cellValue(value) ?? '');
}

/** Reduce an exceljs cell value to a primitive (Date stays a Date so the cleaner formats it). */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if ('text' in v) return v.text; // hyperlink / rich text
    if ('result' in v) return v.result; // formula → its computed result
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((t) => t.text ?? '').join('');
    }
    if ('hyperlink' in v) return v.hyperlink;
  }
  return value;
}
