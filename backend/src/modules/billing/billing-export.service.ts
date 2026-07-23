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
import { statementNo, invoiceNo, expenseDocNo } from './doc-number';
import { StatementExcelRenderer, StatementForExport } from './renderers/statement-excel.renderer';
import { InvoicePdfRenderer, InvoiceForExport } from './renderers/invoice-pdf.renderer';
import { QuickbooksCsvRenderer } from './renderers/quickbooks-csv.renderer';
import { ExpenseDocForExport, ExpenseDocLineForExport, ExpenseDocPdfRenderer } from './renderers/expense-doc-pdf.renderer';

export type StatementFormat = 'excel' | 'quickbooks';
export type InvoiceFormat = 'pdf';

export interface RenderedFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The period a billing document covers. New documents carry a BILLING week (Mon–Sun, "Bill 17"); documents
 * issued before weekly billing carry a pay period and are immutable, so both shapes must render.
 */
interface DocPeriod {
  period_number: number;
  start_date: Date;
  end_date: Date;
}
function resolvePeriod(doc: { billing_period: DocPeriod | null; pay_period: DocPeriod | null }): DocPeriod {
  const period = doc.billing_period ?? doc.pay_period;
  if (!period) {
    throw new NotFoundException('Billing document has no period');
  }
  return period;
}

@Injectable()
export class BillingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly excel: StatementExcelRenderer,
    private readonly pdf: InvoicePdfRenderer,
    private readonly qb: QuickbooksCsvRenderer,
    private readonly expensePdf: ExpenseDocPdfRenderer,
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

  async renderExpenseDoc(id: string): Promise<RenderedFile> {
    const data = await this.expenseDocForExport(id);
    return { filename: `${expenseDocNo(data.document_number)}.pdf`, contentType: 'application/pdf', bytes: await this.expensePdf.render(data) };
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

  async exportExpenseDoc(id: string, actorId: string): Promise<RenderedFile & { file_path: string | null }> {
    const file = await this.renderExpenseDoc(id);
    const file_path = await this.record({ kind: 'expense_bill', format: 'pdf', client_expense_document_id: id, file, actorId });
    await this.audit.log({ actorId, entityType: 'client_expense_documents', entityId: id, action: 'export', after: { format: 'pdf', file_path } });
    return { ...file, file_path };
  }

  /** Upload (when storage is configured) + record a billing_exports row. Returns the stored path or null. */
  private async record(args: {
    kind: string;
    format: string;
    statement_id?: string;
    invoice_id?: string;
    client_expense_document_id?: string;
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
        client_expense_document_id: args.client_expense_document_id ?? null,
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
        lines: { orderBy: [{ sort_order: 'asc' }, { customer_name: 'asc' }] },
        client: { select: { name: true, client_code: true } },
        billing_period: { select: { period_number: true, start_date: true, end_date: true } },
        pay_period: { select: { period_number: true, start_date: true, end_date: true } },
      },
    });
    if (!s) throw new NotFoundException('Statement not found');
    const period = resolvePeriod(s);
    // Money is rendered from the FROZEN line; a legacy line has no component columns, so it reads as 0 —
    // its line_total is still exact, which is what the Total column and the grand total are built from.
    const money = (v: { toString(): string } | null): string => (v ? v.toString() : '0.00');
    return {
      statement_number: s.statement_number,
      client_name: s.client.name,
      client_code: s.client.client_code,
      period_number: period.period_number,
      period_start: dateOnly(period.start_date),
      period_end: dateOnly(period.end_date),
      is_billing_week: s.billing_period !== null,
      spiff_from: s.spiff_from ? dateOnly(s.spiff_from) : null,
      spiff_to: s.spiff_to ? dateOnly(s.spiff_to) : null,
      generated_at: s.generated_at.toISOString(),
      currency: s.currency,
      amount_cad: s.amount_cad?.toString() ?? null,
      lines: s.lines.map((l) => ({
        sale_date: l.sale_date ? dateOnly(l.sale_date) : null,
        rep_code: l.rep_code,
        rep_name: l.rep_name,
        customer_name: l.customer_name,
        customer_first_name: l.customer_first_name,
        customer_last_name: l.customer_last_name,
        address: l.address,
        channel: l.channel,
        product_name: l.product_name,
        has_internet: l.has_internet,
        has_tv: l.has_tv,
        has_home_phone: l.has_home_phone,
        internet_rate: money(l.internet_rate),
        tv_rate: money(l.tv_rate),
        hp_rate: money(l.hp_rate),
        bundle_bonus: money(l.bundle_bonus),
        spiff: money(l.spiff),
        other_total: money(l.other_total),
        products_summary: l.products_summary,
        line_total: l.line_total.toString(),
      })),
      total_amount: s.total_amount.toString(),
    };
  }

  private async invoiceForExport(id: string): Promise<InvoiceForExport> {
    const inv = await this.prisma.clientInvoice.findUnique({
      where: { id },
      include: {
        client: { select: { name: true, client_code: true } },
        billing_period: { select: { period_number: true, start_date: true, end_date: true } },
        pay_period: { select: { period_number: true, start_date: true, end_date: true } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const invPeriod = resolvePeriod(inv);
    return {
      invoice_number: inv.invoice_number,
      client_name: inv.client.name,
      client_code: inv.client.client_code,
      period_number: invPeriod.period_number,
      period_start: dateOnly(invPeriod.start_date),
      period_end: dateOnly(invPeriod.end_date),
      is_billing_week: inv.billing_period !== null,
      generated_at: inv.generated_at.toISOString(),
      currency: inv.currency,
      amount_cad: inv.amount_cad?.toString() ?? null,
      total_commission: inv.total_commission.toString(),
    };
  }

  private async expenseDocForExport(id: string): Promise<ExpenseDocForExport> {
    const doc = await this.prisma.clientExpenseDocument.findUnique({
      where: { id },
      include: {
        client: { select: { name: true, client_code: true } },
        pay_period: { select: { period_number: true, start_date: true, end_date: true } },
      },
    });
    if (!doc) throw new NotFoundException('Expense document not found');
    // line_detail is the FROZEN grouped snapshot (already sorted km → meals → rep → date), money as strings.
    const lines = (doc.line_detail as unknown as ExpenseDocLineForExport[]) ?? [];
    return {
      document_number: doc.document_number,
      client_name: doc.client.name,
      client_code: doc.client.client_code,
      period_number: doc.pay_period.period_number,
      period_start: dateOnly(doc.pay_period.start_date),
      period_end: dateOnly(doc.pay_period.end_date),
      generated_at: doc.generated_at.toISOString(),
      currency: doc.currency,
      amount_cad: doc.amount_cad?.toString() ?? null,
      total_amount: doc.total_amount.toString(),
      lines: lines.map((l) => ({ type: l.type, rep_name: l.rep_name, date: l.date, description: l.description, amount: l.amount })),
    };
  }
}
