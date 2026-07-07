import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { SequenceService } from '../../common/sequence/sequence.service';
import { BillingGenerationController } from './billing-generation.controller';
import { StatementsController, InvoicesController } from './billing.controller';
import { ExpenseDocGenerationController, ExpenseDocumentsController } from './expense-doc.controller';
import { StatementService } from './statement.service';
import { InvoiceService } from './invoice.service';
import { ClientExpenseDocService } from './expense-doc.service';
import { BillingExportService } from './billing-export.service';
import { StatementExcelRenderer } from './renderers/statement-excel.renderer';
import { InvoicePdfRenderer } from './renderers/invoice-pdf.renderer';
import { QuickbooksCsvRenderer } from './renderers/quickbooks-csv.renderer';
import { ExpenseDocPdfRenderer } from './renderers/expense-doc-pdf.renderer';

/**
 * BillingModule — client statements + commission invoices + the client EXPENSE billing document (BILL-012).
 * Priced SOLELY from client_billing_rates (statements/invoices) or expense_items + client-bill km rate
 * (expense docs) — NEVER commission (#3). Gapless-numbered + immutable (versioned). Real Excel/PDF/QuickBooks
 * rendered on demand + recorded (StorageModule). No Pay Run change.
 */
@Module({
  imports: [StorageModule],
  controllers: [
    BillingGenerationController,
    StatementsController,
    InvoicesController,
    ExpenseDocGenerationController,
    ExpenseDocumentsController,
  ],
  providers: [
    StatementService,
    InvoiceService,
    ClientExpenseDocService,
    BillingExportService,
    SequenceService,
    StatementExcelRenderer,
    InvoicePdfRenderer,
    QuickbooksCsvRenderer,
    ExpenseDocPdfRenderer,
  ],
  exports: [StatementService], // Reconciliation reuses priceClientPeriod for the live re-price (billing stream only).
})
export class BillingModule {}
