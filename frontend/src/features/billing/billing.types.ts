/**
 * Billing types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships `@ApiResponse`
 * DTOs as of Batch A #2). Mirrors `backend/src/modules/billing/dto/billing.response.ts`. This is the
 * CLIENT-FACING BILLING stream: a statement is priced SOLELY from client_billing_rates by the SERVER (#3) —
 * there is NO commission field here, ever. Money is an exact-decimal STRING; the UI prices nothing (#1).
 */
import type { components } from '../../api/generated/schema';

/** ONE LINE PER CUSTOMER — the backend aggregates a sale's products into a single line. */
export type ClientStatementLine = components['schemas']['ClientStatementLineResponse'];

export type ClientStatement = components['schemas']['ClientStatementResponse'];

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
  pay_period_id?: string;
}

/** The export action's response (stub file_url; the audit row is the record). */
export type BillingExportResult = components['schemas']['BillingExportResultResponse'];

// Request bodies — typed from the generated schema.
export type GenerateBillingBody = components['schemas']['GenerateBillingDto'];
export type BillingExportBody = components['schemas']['BillingExportDto'];
