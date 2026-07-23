/**
 * StatementExcelRenderer — the workbook Redwave sends the client, reproduced from the FROZEN statement.
 *
 * Layout (docs/uat/billing-target-format.md, verified against docs/uat/"Sample Billing for Client.xlsx"):
 *   row 1  summary strip — ABOVE the header: Internet/TV/HP counts + a total per money column + grand total
 *   row 2  header
 *   row 3+ one row per sale
 *
 * The strip uses live `COUNTIF` / `SUBTOTAL(9,…)` formulas over an autofiltered range — deliberately, because
 * the client filters the sheet and expects the totals to follow (the source workbook does exactly this).
 * Values still come only from frozen line data; the formulas re-add, they never re-price. The UI gets the
 * same figures pre-summed from the server (`statement-summary.logic`), so both audiences agree.
 *
 * An "Other" column appears only when some row has a non-zero `other_total` — a priced product with no column
 * of its own must never be silently dropped, but the common case stays the exact 17-column target.
 * NO GST/tax (BILL-004). — SRS BILL-002
 */
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { statementNo } from '../doc-number';

export interface StatementLineForExport {
  sale_date: string | null; // 'YYYY-MM-DD'
  rep_code: string | null;
  rep_name: string | null;
  customer_name: string;
  customer_first_name: string | null;
  customer_last_name: string | null;
  address: string | null;
  channel: string | null;
  product_name: string | null;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  internet_rate: string;
  tv_rate: string;
  hp_rate: string;
  bundle_bonus: string;
  spiff: string;
  other_total: string;
  products_summary: string;
  line_total: string;
}

export interface StatementForExport {
  statement_number: number | null;
  client_name: string;
  client_code: string;
  period_number: number;
  period_start: string; // 'YYYY-MM-DD'
  period_end: string; // 'YYYY-MM-DD'
  /** true → the period is a billing week ("Bill 17"); false → a legacy pay-period statement. */
  is_billing_week: boolean;
  /** The applied spiff's own window, shown in that column's header when known. */
  spiff_from: string | null;
  spiff_to: string | null;
  generated_at: string;
  currency: string; // the document's billing currency (#12)
  amount_cad: string | null; // frozen CAD equivalent (null on legacy rows)
  lines: StatementLineForExport[];
  total_amount: string;
}

const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;

/** Column letter for a 1-based index (A..Z is plenty — the sheet has at most 18 columns). */
const col = (index: number): string => String.fromCharCode('A'.charCodeAt(0) + index - 1);

const asDate = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

/** "Jun 29 – Jul 5, 2026" — the range printed in the Spiff column header. */
function rangeLabel(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return to ? `${fmt(from)} – ${fmt(to)}` : `from ${fmt(from)}`;
}

@Injectable()
export class StatementExcelRenderer {
  async render(s: StatementForExport): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Redwave Marketing Inc.';
    const ws = wb.addWorksheet(`${s.client_code} Bill`);

    // The "Other" column exists only when it carries money — otherwise the sheet is the exact target layout.
    const showOther = s.lines.some((l) => Number(l.other_total) !== 0);
    const spiffRange =
      rangeLabel(s.spiff_from, s.spiff_to) ?? rangeLabel(s.period_start, s.period_end) ?? '';

    const headers = [
      'Sale Date',
      'Agent ID',
      'Agent Name',
      "Customer's First Name",
      "Customer's Last Name",
      'Address',
      'Channel',
      'Product',
      'Internet',
      'TV',
      'Home Phone',
      `Internet Rate (${s.currency})`,
      `TV Rate (${s.currency})`,
      `HP Rate (${s.currency})`,
      `Bundle Bonus (${s.currency})`,
      `Spiff (${spiffRange})`,
      ...(showOther ? [`Other (${s.currency})`] : []),
      `Total (${s.currency})`,
    ];
    ws.columns = [
      { width: 12 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 40 },
      { width: 10 }, { width: 22 }, { width: 10 }, { width: 8 }, { width: 12 },
      ...Array.from({ length: showOther ? 7 : 6 }, () => ({ width: 14 })),
    ];

    // Column positions (1-based) — the flag columns are counted, the money columns are subtotalled.
    const firstFlag = 9; // Internet
    const firstMoney = 12; // Internet Rate
    const lastMoney = headers.length; // Total
    const lastDataRow = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + s.lines.length - 1);

    // ── Row 1 — the summary strip, ABOVE the header (the client's convention). Live formulas so the numbers
    //    follow the autofilter; SUBTOTAL(9,…) ignores rows the client has filtered out.
    const summary = ws.getRow(1);
    if (s.lines.length > 0) {
      for (let c = firstFlag; c < firstMoney; c += 1) {
        summary.getCell(c).value = { formula: `COUNTIF(${col(c)}${FIRST_DATA_ROW}:${col(c)}${lastDataRow},TRUE)`, date1904: false };
      }
      for (let c = firstMoney; c <= lastMoney; c += 1) {
        const cell = summary.getCell(c);
        cell.value = { formula: `SUBTOTAL(9,${col(c)}${FIRST_DATA_ROW}:${col(c)}${lastDataRow})`, date1904: false };
        cell.numFmt = '#,##0.00';
      }
    }
    summary.getCell(1).value = `${statementNo(s.statement_number)} · ${s.client_name} (${s.client_code})`;
    summary.getCell(6).value = s.is_billing_week
      ? `Bill ${s.period_number}: ${s.period_start} → ${s.period_end}`
      : `Period ${s.period_number}: ${s.period_start} → ${s.period_end}`;
    summary.font = { bold: true };

    // ── Row 2 — the header.
    const header = ws.getRow(HEADER_ROW);
    header.values = headers;
    header.font = { bold: true };
    header.eachCell((c) => {
      c.border = { bottom: { style: 'thin' } };
      c.alignment = { wrapText: true, vertical: 'bottom' };
    });

    // ── Row 3+ — one row per sale. Dates and booleans are written as REAL types so the client can filter and
    //    so COUNTIF(…,TRUE) matches; money is a number carrying the exact frozen 2-dp value (display only).
    for (const l of s.lines) {
      const row = ws.addRow([
        asDate(l.sale_date),
        l.rep_code ?? '',
        l.rep_name ?? '',
        l.customer_first_name ?? '',
        l.customer_last_name ?? '',
        l.address ?? '',
        l.channel ?? '',
        l.product_name ?? '',
        l.has_internet,
        l.has_tv,
        l.has_home_phone,
        Number(l.internet_rate),
        Number(l.tv_rate),
        Number(l.hp_rate),
        Number(l.bundle_bonus),
        Number(l.spiff),
        ...(showOther ? [Number(l.other_total)] : []),
        Number(l.line_total),
      ]);
      row.getCell(1).numFmt = 'yyyy-mm-dd';
      for (let c = firstMoney; c <= lastMoney; c += 1) row.getCell(c).numFmt = '#,##0.00';
    }

    // The filter spans header + data so the strip's SUBTOTALs respond to it.
    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: lastDataRow, column: lastMoney } };
    ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

    // For a foreign document show the frozen CAD equivalent (the reconciliation figure, #12).
    if (s.currency !== 'CAD' && s.amount_cad) {
      ws.addRow([]);
      const cad = ws.addRow(['CAD equivalent (frozen at issue)']);
      cad.getCell(1).font = { bold: true };
      cad.getCell(2).value = Number(s.amount_cad);
      cad.getCell(2).numFmt = '#,##0.00';
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
