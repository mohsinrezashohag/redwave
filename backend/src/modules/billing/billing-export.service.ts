/**
 * BillingExportService — renders statements/invoices to REAL files and records the export.
 *
 * Files render ON DEMAND from the FROZEN, immutable record (so a re-download always reproduces the issued
 * document). `download*` streams the bytes (works with storage off). `export*` additionally records a
 * `billing_exports` row and — when object storage is configured — uploads a copy (like expense_exports).
 * Reads only billing rows; touches NO commission stream (#3). Single-currency CAD, no GST. — SRS BILL-002/003
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { statementNo, invoiceNo } from './doc-number';
import { StatementExcelRenderer, StatementForExport } from './renderers/statement-excel.renderer';
import { InvoicePdfRenderer, InvoiceForExport } from './renderers/invoice-pdf.renderer';
import { QuickbooksCsvRenderer } from './renderers/quickbooks-csv.renderer';

export type StatementFormat = 'excel' | 'quickbooks';
export type InvoiceFormat = 'pdf';

export interface RenderedFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

@Injectable()
export class BillingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly excel: StatementExcelRenderer,
    private readonly pdf: InvoicePdfRenderer,
    private readonly qb: QuickbooksCsvRenderer,
  ) {}

  // ── Render (from the frozen record) ─────────────────────────────────────────────────────────────
  async renderStatement(id: string, format: StatementFormat): Promise<RenderedFile> {
    const data = await this.statementForExport(id);
    if (format === 'quickbooks') {
      return { filename: `${statementNo(data.statement_number)}-quickbooks.csv`, contentType: 'text/csv', bytes: this.qb.render(data) };
    }
    return {
      filename: `${statementNo(data.statement_number)}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: await this.excel.render(data),
    };
  }

  async renderInvoice(id: string): Promise<RenderedFile> {
    const data = await this.invoiceForExport(id);
    return { filename: `${invoiceNo(data.invoice_number)}.pdf`, contentType: 'application/pdf', bytes: await this.pdf.render(data) };
  }

  // ── Export (render + record + optional upload) ──────────────────────────────────────────────────
  async exportStatement(id: string, format: StatementFormat, actorId: string): Promise<RenderedFile & { file_path: string | null }> {
    const file = await this.renderStatement(id, format);
    const kind = format === 'quickbooks' ? 'quickbooks' : 'statement';
    const file_path = await this.record({ kind, format: format === 'quickbooks' ? 'csv' : 'excel', statement_id: id, file: file, actorId });
    await this.audit.log({ actorId, entityType: 'client_statements', entityId: id, action: 'export', after: { format, file_path } });
    return { ...file, file_path };
  }

  async exportInvoice(id: string, actorId: string): Promise<RenderedFile & { file_path: string | null }> {
    const file = await this.renderInvoice(id);
    const file_path = await this.record({ kind: 'invoice', format: 'pdf', invoice_id: id, file, actorId });
    await this.audit.log({ actorId, entityType: 'client_invoices', entityId: id, action: 'export', after: { format: 'pdf', file_path } });
    return { ...file, file_path };
  }

  /** Upload (when storage is configured) + record a billing_exports row. Returns the stored path or null. */
  private async record(args: {
    kind: string;
    format: string;
    statement_id?: string;
    invoice_id?: string;
    file: RenderedFile;
    actorId: string;
  }): Promise<string | null> {
    let path: string | null = null;
    if (this.storage.isConfigured()) {
      const stored = await this.storage.uploadBuffer('billing', args.file.filename, args.file.bytes, args.file.contentType);
      path = stored.path;
    }
    await this.prisma.billingExport.create({
      data: {
        kind: args.kind,
        format: args.format,
        statement_id: args.statement_id ?? null,
        invoice_id: args.invoice_id ?? null,
        file_path: path ?? `pending://${args.file.filename}`,
        generated_by: args.actorId,
      },
    });
    return path;
  }

  // ── Fetch + map the frozen records into renderer inputs ─────────────────────────────────────────
  private async statementForExport(id: string): Promise<StatementForExport> {
    const s = await this.prisma.clientStatement.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { customer_name: 'asc' } },
        client: { select: { name: true, client_code: true } },
        pay_period: { select: { period_number: true, start_date: true, end_date: true } },
      },
    });
    if (!s) throw new NotFoundException('Statement not found');
    return {
      statement_number: s.statement_number,
      client_name: s.client.name,
      client_code: s.client.client_code,
      period_number: s.pay_period.period_number,
      period_start: dateOnly(s.pay_period.start_date),
      period_end: dateOnly(s.pay_period.end_date),
      generated_at: s.generated_at.toISOString(),
      currency: s.currency,
      amount_cad: s.amount_cad?.toString() ?? null,
      lines: s.lines.map((l) => ({ customer_name: l.customer_name, products_summary: l.products_summary, line_total: l.line_total.toString() })),
      total_amount: s.total_amount.toString(),
    };
  }

  private async invoiceForExport(id: string): Promise<InvoiceForExport> {
    const inv = await this.prisma.clientInvoice.findUnique({
      where: { id },
      include: {
        client: { select: { name: true, client_code: true } },
        pay_period: { select: { period_number: true, start_date: true, end_date: true } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return {
      invoice_number: inv.invoice_number,
      client_name: inv.client.name,
      client_code: inv.client.client_code,
      period_number: inv.pay_period.period_number,
      period_start: dateOnly(inv.pay_period.start_date),
      period_end: dateOnly(inv.pay_period.end_date),
      generated_at: inv.generated_at.toISOString(),
      currency: inv.currency,
      amount_cad: inv.amount_cad?.toString() ?? null,
      total_commission: inv.total_commission.toString(),
    };
  }
}
