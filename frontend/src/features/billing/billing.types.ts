/**
 * Billing types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships `@ApiResponse`
 * DTOs as of Batch A #2). Mirrors `backend/src/modules/billing/dto/billing.response.ts`. This is the
 * CLIENT-FACING BILLING stream: a statement is priced SOLELY from client_billing_rates by the SERVER (#3) —
 * there is NO commission field here, ever. Money is an exact-decimal STRING; the UI prices nothing (#1).
 */
import type { components } from '../../api/generated/schema';

/** ONE ROW PER SALE, carrying the amount from every rate kind — the client workbook's line. */
export type ClientStatementLine = components['schemas']['ClientStatementLineResponse'];

/** Counts + column totals, summed by the SERVER from the frozen lines — the workbook's summary strip. */
export type StatementSummary = components['schemas']['StatementSummaryResponse'];

/** A billing WEEK (Mon–Sun) with a sequential bill number — "Bill 17". Not a pay period. */
export type BillingPeriod = components['schemas']['BillingPeriodResponse'];

export type ClientStatement = components['schemas']['ClientStatementResponse'];

/** A NON-PERSISTED preview of the one-line-per-customer draft (no number minted). */
export type StatementPreview = components['schemas']['StatementPreviewResponse'];

/** issued = current; superseded = an earlier immutable version. */
export type BillingDocStatus = ClientStatement['status'];

/** The one-line commission invoice — total_commission == the statement total (billing stream only, #3). */
export type ClientInvoice = components['schemas']['ClientInvoiceResponse'];

/**
 * A 422 unpriced-product detail (from the ERROR envelope's `details.unpriced`, NOT a success response) —
 * surfaced helpfully so the user can add a rate. Hand-written: it lives in the error body, not the contract.
 */
export interface UnpricedDetail {
  product_id: string;
  product_name: string;
  sale_date: string;
}

export interface BillingFilters {
  client_id?: string;
  billing_period_id?: string;
}

// Request bodies — typed from the generated schema.
export type GenerateBillingBody = components['schemas']['GenerateBillingDto'];
/** Statement export format — `excel` (the client workbook) | `quickbooks` (a QB-mappable CSV, no tax). */
export type StatementExportFormat = components['schemas']['StatementExportDto']['format'];
