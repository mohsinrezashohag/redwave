/**
 * QuickbooksCsvRenderer — exports a statement (and a financial summary) as a CSV that maps cleanly into
 * QuickBooks. Tax lives in QuickBooks, so there is **NO tax column** here; single-currency **CAD**. One CSV
 * row per customer line (the QB "invoice line"). — SRS BILL (QuickBooks export)
 *
 * Column mapping (QB Online invoice import):
 *   InvoiceNo, Customer, InvoiceDate, DueDate, Item, Description, Amount, Currency
 */
import { Injectable } from '@nestjs/common';
import { statementNo } from '../doc-number';
import type { StatementForExport } from './statement-excel.renderer';

const BOM = '﻿'; // so Excel/QuickBooks read UTF-8 correctly
const esc = (v: string | number): string => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toRow = (cells: (string | number)[]): string => cells.map(esc).join(',');

@Injectable()
export class QuickbooksCsvRenderer {
  /** Per-customer invoice lines for one statement. */
  render(s: StatementForExport): Buffer {
    const invoiceDate = s.period_end; // bill as of the period close
    const headers = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Item', 'Description', 'Amount', 'Currency'];
    const rows = s.lines.map((l) =>
      toRow([statementNo(s.statement_number), l.customer_name, invoiceDate, '', 'Telecom Services', l.products_summary, l.line_total, s.currency]),
    );
    return Buffer.from(`${BOM}${toRow(headers)}\n${rows.join('\n')}\n`, 'utf8');
  }

  /** A financial summary roll-up across statements (one row per statement). */
  renderSummary(rows: { statement_number: number | null; client_name: string; period_number: number; total_amount: string; currency: string }[]): Buffer {
    const headers = ['InvoiceNo', 'Customer', 'PayPeriod', 'Amount', 'Currency'];
    const body = rows.map((r) =>
      toRow([statementNo(r.statement_number), r.client_name, r.period_number, r.total_amount, r.currency]),
    );
    return Buffer.from(`${BOM}${toRow(headers)}\n${body.join('\n')}\n`, 'utf8');
  }
}
