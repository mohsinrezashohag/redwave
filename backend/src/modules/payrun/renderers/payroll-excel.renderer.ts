/**
 * PayrollExcelRenderer — Redwave's own payroll workbook, reproduced from the FROZEN payroll lines.
 *
 * Layout (docs/uat/payroll-target-format.md, verified against docs/uat/"Payroll report.xlsx" as parsed in
 * system-audit.md §1.1):
 *   row 1  SUBTOTAL strip — ABOVE the header, on the three MONEY columns only
 *   row 2  header
 *   row 3+ one row per sale
 *
 * TWO DIFFERENCES FROM THE STATEMENT RENDERER, both taken from their actual file rather than assumed:
 *   1. The strip carries **no COUNTIF** on the Internet/TV/HP flag columns. The billing sheet has them;
 *      the payroll sheet does not. Mirroring the statement renderer verbatim would add columns of numbers
 *      Redwave does not put there.
 *   2. `Customer` and `Address` are ONE column each. The client statement splits the customer name into
 *      first/last; the payroll sheet holds a first name only.
 *
 * `Greenfield` and `Spiff` are the two ADDITIONS to their sheet, confirmed in Meeting 4 — inserted before
 * `Total 100 %`, giving the 18-column target.
 *
 * Every value is the frozen snapshot (#2). Nothing is re-priced, and no client billing rate is reachable
 * from here (#3) — the whole point of the report is that the rep stream is separate.
 */
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import {
  EXPORT_REGISTRY,
  LayoutColumn,
  defaultLayout,
} from '../../../common/export/export-fields.registry';

export interface PayrollLineForExport {
  sale_date: string | null; // 'YYYY-MM-DD'
  rep_external_code: string | null;
  rep_code: string | null;
  rep_name: string | null;
  customer_name: string;
  address: string | null;
  channel: string | null;
  product_name: string | null;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  is_greenfield: boolean;
  internet_rate: string;
  tv_rate: string;
  hp_rate: string;
  greenfield: string;
  spiff: string;
  other_total: string;
  total_100: string;
  advance_70: string;
  holdback_30: string;
}

export interface PayrollReportForExport {
  /**
   * The configured column layout, or undefined for the built-in default. An ISSUED document passes the
   * layout it was issued with, so a re-render reproduces the original rather than today's config (#2).
   */
  layout?: LayoutColumn[];
  pay_run_id: string;
  period_number: number;
  period_start: string; // 'YYYY-MM-DD'
  period_end: string; // 'YYYY-MM-DD'
  run_status: string;
  generated_at: string;
  /** The advance / holdback split in force for the run's period — heads the two split columns. */
  split?: { advance_pct: string; holdback_pct: string } | null;
  /**
   * There is no holdback since 2026-11-13: the two split columns are printed ONLY for an old run that held
   * some (true). Omitted / false → the sheet ends at the total.
   */
  has_holdback?: boolean;
  lines: PayrollLineForExport[];
  total_100: string;
  advance_70: string;
  holdback_30: string;
}

/** The 70% / 30% columns: shown only for an old run that held some (no holdback since 2026-11-13). */
const SPLIT_FIELDS = new Set(['advance_70', 'holdback_30']);

const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;

/** Column letter for a 1-based index (A..Z is plenty — the sheet has at most 19 columns). */
const col = (index: number): string => String.fromCharCode('A'.charCodeAt(0) + index - 1);

const asDate = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

@Injectable()
export class PayrollExcelRenderer {
  async render(r: PayrollReportForExport): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Redwave Marketing Inc.';
    const ws = wb.addWorksheet(`Payroll P${r.period_number}`);

    // "Other" appears only when it carries money — otherwise the sheet is the exact 18-column target. A
    // priced item must never be silently dropped, but the common case should match their file.
    const showOther = r.lines.some((l) => Number(l.other_total) !== 0);

    // The layout decides column SELECTION, ORDER and LABEL; the layout ENGINE below is fixed, because the
    // SUBTOTAL strip references columns positionally. A layout that would break that is rejected before it
    // is ever stored (export-fields.registry#validateLayout), so by here it is safe to render.
    const registry = new Map(EXPORT_REGISTRY.payroll.fields.map((f) => [f.key, f]));
    const columns = (r.layout ?? defaultLayout('payroll')).filter(
      // `other_total` is dropped when it carries no money, exactly as before — an empty column adds noise.
      (c) => (c.field !== 'other_total' || showOther) && (r.has_holdback || !SPLIT_FIELDS.has(c.field)),
    );
    // The split columns are headed by the split itself ("0.7" / "0.3", as in Redwave's file). Print the
    // run's REAL split instead of the default label — at 100/0 (Redwave, 2026-11-11) a "0.7" header over a
    // column that is 100% of the line would be wrong. A header an admin renamed is left exactly as they set it.
    const splitHeader: Record<string, string | undefined> = {
      advance_70: r.split ? new Decimal(r.split.advance_pct).toString() : undefined,
      holdback_30: r.split ? new Decimal(r.split.holdback_pct).toString() : undefined,
    };
    const headers = columns.map((c) => {
      const label = c.header ?? registry.get(c.field)?.label ?? c.field;
      const isDefault = label === registry.get(c.field)?.label;
      return isDefault && splitHeader[c.field] ? (splitHeader[c.field] as string) : label;
    });
    ws.columns = columns.map((c) => ({ width: registry.get(c.field)?.money ? 14 : c.field === 'address' ? 40 : 16 }));

    // The money block is contiguous by construction (validated), so its bounds are its first and last index.
    const moneyIdx = columns
      .map((c, i) => (registry.get(c.field)?.money ? i + 1 : -1))
      .filter((i) => i > 0);
    const firstMoney = moneyIdx[0] ?? headers.length + 1;
    const lastMoney = moneyIdx[moneyIdx.length - 1] ?? headers.length;
    const lastDataRow = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + r.lines.length - 1);

    // ── Row 1 — the SUBTOTAL strip, ABOVE the header. Live formulas so the totals follow the autofilter,
    //    exactly as their file does. NO COUNTIF on the flag columns: their payroll sheet has none.
    const summary = ws.getRow(1);
    if (r.lines.length > 0) {
      for (let c = firstMoney; c <= lastMoney; c += 1) {
        const cell = summary.getCell(c);
        cell.value = { formula: `SUBTOTAL(9,${col(c)}${FIRST_DATA_ROW}:${col(c)}${lastDataRow})`, date1904: false };
        cell.numFmt = '#,##0.00';
      }
    }
    summary.getCell(1).value = `Payroll · Period ${r.period_number}`;
    if (firstMoney > 5) summary.getCell(5).value = `${r.period_start} → ${r.period_end}`;
    summary.font = { bold: true };

    // ── Row 2 — the header.
    const header = ws.getRow(HEADER_ROW);
    header.values = headers;
    header.font = { bold: true };
    header.eachCell((c) => {
      c.border = { bottom: { style: 'thin' } };
      c.alignment = { wrapText: true, vertical: 'bottom' };
    });

    // ── Row 3+ — one row per sale. Dates and booleans are REAL types so the sheet filters correctly;
    //    money is a number carrying the exact frozen 2-dp value (display only — nothing is recomputed).
    // One cell per configured column. Dates and booleans stay REAL types so the sheet filters correctly;
    // money is a number carrying the exact frozen 2-dp value (display only — nothing is recomputed).
    const cellFor = (l: PayrollLineForExport, field: string): ExcelJS.CellValue => {
      switch (field) {
        case 'sale_date':
          return asDate(l.sale_date);
        // Agent ID is the PARTNER's code (`Redwave11`) — what both of Redwave's workbooks key agents by.
        // A rep without one falls back to the internal code so the column is never blank.
        case 'rep_external_code':
          return l.rep_external_code ?? l.rep_code ?? '';
        case 'rep_name':
          return l.rep_name ?? '';
        case 'customer_name':
          return l.customer_name;
        case 'address':
          return l.address ?? '';
        case 'channel':
          return l.channel ?? '';
        case 'product_name':
          return l.product_name ?? '';
        case 'has_internet':
          return l.has_internet;
        case 'has_tv':
          return l.has_tv;
        case 'has_home_phone':
          return l.has_home_phone;
        default: {
          const value = (l as unknown as Record<string, string | undefined>)[field];
          return registry.get(field)?.money ? Number(value ?? '0') : (value ?? '');
        }
      }
    };

    for (const l of r.lines) {
      const row = ws.addRow(columns.map((c) => cellFor(l, c.field)));
      const dateIdx = columns.findIndex((c) => c.field === 'sale_date');
      if (dateIdx >= 0) row.getCell(dateIdx + 1).numFmt = 'yyyy-mm-dd';
      for (let c = firstMoney; c <= lastMoney; c += 1) row.getCell(c).numFmt = '#,##0.00';
    }

    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: lastDataRow, column: lastMoney } };
    ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
