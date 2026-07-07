/**
 * Client EXPENSE billing document types — RESPONSE shapes ALIASED to the generated OpenAPI schema. Mirrors
 * `backend/src/modules/billing/dto/expense-doc.response.ts`. This is the CLIENT-FACING expense stream: km is
 * priced by the SERVER from the CLIENT-BILL km rate, food is native-currency — NO commission data (#3). Money
 * is an exact-decimal STRING; the UI prices nothing (#1).
 */
import type { components } from '../../api/generated/schema';

export type ClientExpenseDocument = components['schemas']['ClientExpenseDocumentResponse'];
export type ExpenseDocLine = components['schemas']['ExpenseDocLineResponse'];
export type ExpenseDocPreview = components['schemas']['ExpenseDocPreviewResponse'];
export type ExcludedExpenseItem = components['schemas']['ExcludedExpenseItemResponse'];

/** issued = current; superseded = an earlier immutable version. */
export type BillingDocStatus = ClientExpenseDocument['status'];

export interface ExpenseDocFilters {
  client_id?: string;
  pay_period_id?: string;
}

// Request body — typed from the generated schema.
export type GenerateExpenseDocBody = components['schemas']['GenerateExpenseDocDto'];
