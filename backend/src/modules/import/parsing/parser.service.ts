/**
 * ParserService — turns an uploaded Excel/CSV/TSV file into `{ headers, rows }` of raw cell values. Excel
 * (.xlsx/.xls) via **exceljs** (maintained, no critical parse-side CVEs); CSV/TSV via **papaparse**.
 * A malformed/empty file → a clean 422 (never a crash/500). — SRS §15 IMP-003/011
 *
 * Two pieces of tolerance make real partner files work, and both are SCORED against the target's own field
 * aliases rather than guessed positionally:
 *  - **Sheet selection.** A workbook often carries an "Instructions" or "Summary" tab before the data. The
 *    first non-empty sheet is frequently the wrong one, so every sheet's best header row is scored and the
 *    highest wins. An explicitly requested sheet always overrides.
 *  - **Header-row detection.** Files routinely open with a title banner, a blank row, or an export
 *    timestamp. Taking "the first row with any content" makes that junk the header and every column then
 *    fails to map, so the first rows are scored and the best is chosen.
 * With no expected fields supplied both fall back to the previous behaviour (first sheet, first non-empty
 * row), so callers that don't care are unaffected.
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { UploadedFile } from '../../../common/storage/storage.service';
import { RawRow } from '../mapping.logic';
import { normalizeToken } from '../normalize';
import { TargetField } from '../target-fields';

export interface ParseOptions {
  /** Parse this worksheet by name (case-insensitive). Overrides auto-selection. */
  sheet?: string;
  /** The target's expected fields — used to SCORE candidate sheets and header rows. */
  expectedFields?: TargetField[];
}

export interface ParseResult {
  /** The worksheet actually parsed (null for CSV/TSV). */
  sheet: string | null;
  /** Every worksheet in the workbook, so the operator can pick a different one (empty for CSV/TSV). */
  sheets: string[];
  /** 1-based row number the headers were read from. */
  headerRow: number;
  headers: string[];
  rows: RawRow[];
}

/** How many leading rows to consider as header candidates. */
const HEADER_SCAN_ROWS = 15;

@Injectable()
export class ParserService {
  async parse(file: UploadedFile, options: ParseOptions = {}): Promise<ParseResult> {
    const name = file.originalname.toLowerCase();
    const isCsv = name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.mimetype.includes('csv');
    const result = isCsv ? this.parseDelimited(file, options) : await this.parseExcel(file, options);
    if (result.headers.length === 0) {
      throw new UnprocessableEntityException('the file has no header row');
    }
    if (result.rows.length === 0) {
      throw new UnprocessableEntityException('the file has no data rows');
    }
    return result;
  }

  /** The worksheet names in an uploaded workbook, without parsing any rows. */
  async listSheets(file: UploadedFile): Promise<string[]> {
    const wb = await this.loadWorkbook(file);
    return wb.worksheets.map((w) => w.name);
  }

  private parseDelimited(file: UploadedFile, options: ParseOptions): ParseResult {
    const raw = file.buffer.toString('utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip a UTF-8 BOM if present
    const delimiter = file.originalname.toLowerCase().endsWith('.tsv') ? '\t' : '';

    // A CSV can carry a title banner too, so find the header line the same way — then re-parse from it.
    const skip = this.delimitedHeaderOffset(text, delimiter, options.expectedFields);
    const body = skip === 0 ? text : text.split(/\r?\n/).slice(skip).join('\n');

    const parsed = Papa.parse<Record<string, unknown>>(body, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      delimiter,
    });
    const headers = (parsed.meta.fields ?? []).filter((h) => h && h.trim() !== '');
    const rows = (parsed.data as RawRow[]).filter((r) =>
      Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== ''),
    );
    return { sheet: null, sheets: [], headerRow: skip + 1, headers, rows };
  }

  /** How many leading lines to drop so the header line comes first. 0 when the first line is already best. */
  private delimitedHeaderOffset(text: string, delimiter: string, expectedFields?: TargetField[]): number {
    const lines = text.split(/\r?\n/).slice(0, HEADER_SCAN_ROWS);
    let bestIndex = -1;
    let bestScore = -1;
    for (let i = 0; i < lines.length; i++) {
      const cells = Papa.parse<string[]>(lines[i], { delimiter }).data[0] ?? [];
      const score = scoreHeaderRow(cells, expectedFields);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex > 0 ? bestIndex : 0;
  }

  private async loadWorkbook(file: UploadedFile): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs accepts a Node Buffer; cast through unknown to satisfy its ArrayBuffer-typed signature.
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new UnprocessableEntityException('could not read the Excel file (is it a valid .xlsx?)');
    }
    return wb;
  }

  private async parseExcel(file: UploadedFile, options: ParseOptions): Promise<ParseResult> {
    const wb = await this.loadWorkbook(file);
    const sheets = wb.worksheets.map((w) => w.name);
    const populated = wb.worksheets.filter((w) => w.rowCount > 0 && w.actualColumnCount > 0);
    if (populated.length === 0) {
      throw new UnprocessableEntityException('the workbook has no data');
    }

    // An explicitly requested sheet always wins — the operator has seen the list and chosen.
    let chosen: ExcelJS.Worksheet | undefined;
    if (options.sheet) {
      chosen = wb.worksheets.find((w) => w.name.toLowerCase() === options.sheet!.toLowerCase());
      if (!chosen) {
        throw new UnprocessableEntityException(`the workbook has no sheet named "${options.sheet}" (found: ${sheets.join(', ')})`);
      }
    }

    let headerRowNumber = 0;
    if (chosen) {
      headerRowNumber = this.bestHeaderRow(chosen, options.expectedFields).row;
    } else {
      // Score every populated sheet by its best header row and take the winner.
      let bestScore = -1;
      for (const ws of populated) {
        const candidate = this.bestHeaderRow(ws, options.expectedFields);
        if (candidate.score > bestScore) {
          bestScore = candidate.score;
          chosen = ws;
          headerRowNumber = candidate.row;
        }
      }
    }
    const ws = chosen!;
    if (headerRowNumber === 0) {
      return { sheet: ws.name, sheets, headerRow: 0, headers: [], rows: [] };
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

    return { sheet: ws.name, sheets, headerRow: headerRowNumber, headers, rows };
  }

  /** Score the first rows of a worksheet and return the best header candidate. */
  private bestHeaderRow(ws: ExcelJS.Worksheet, expectedFields?: TargetField[]): { row: number; score: number } {
    let bestRow = 0;
    let bestScore = -1;
    const limit = Math.min(ws.rowCount, HEADER_SCAN_ROWS);
    for (let n = 1; n <= limit; n++) {
      const cells: string[] = [];
      ws.getRow(n).eachCell({ includeEmpty: false }, (cell) => cells.push(cellText(cell.value)));
      const score = scoreHeaderRow(cells, expectedFields);
      if (score > bestScore) {
        bestScore = score;
        bestRow = n;
      }
    }
    return { row: bestRow, score: bestScore };
  }
}

/**
 * Score a candidate header row. A header looks like several short, non-numeric, distinct text cells — and,
 * when the caller supplied the target's fields, it is worth far more if its cells actually match the
 * expected aliases. That alias term is what lets a "Summary" tab lose to the real data tab.
 */
export function scoreHeaderRow(cells: string[], expectedFields?: TargetField[]): number {
  const values = cells.map((c) => (c ?? '').trim()).filter((c) => c !== '');
  if (values.length === 0) return -1;

  const numeric = values.filter((v) => /^-?[\d.,$%\s]+$/.test(v)).length;
  const distinct = new Set(values.map((v) => normalizeToken(v))).size;

  let score = distinct * 2; // several distinct labels
  score -= numeric * 3; // a row of numbers is data, not a header
  if (values.length === 1) score -= 4; // a lone cell is almost always a title banner

  if (expectedFields && expectedFields.length > 0) {
    const known = new Set<string>();
    for (const field of expectedFields) {
      known.add(normalizeToken(field.field));
      known.add(normalizeToken(field.label));
      for (const alias of field.aliases) known.add(normalizeToken(alias));
    }
    const hits = values.filter((v) => {
      const n = normalizeToken(v);
      return n !== '' && (known.has(n) || [...known].some((k) => k.length >= 3 && (n.includes(k) || k.includes(n))));
    }).length;
    score += hits * 10; // matching the target's own vocabulary dominates
  }
  return score;
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
