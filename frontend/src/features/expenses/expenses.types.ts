/**
 * Expenses types — ITEM-FIRST. RESPONSE shapes ALIASED to the generated OpenAPI schema (mirrors
 * `backend/src/modules/expenses/dto/expense.response.ts`). The expense ITEM is the atomic unit: it carries
 * its own submitter/status/approver and a pay_period derived from its expense_date. Money/km amounts are
 * decimal STRINGS; the km amount is computed SERVER-SIDE. REQUEST bodies are typed from the schema.
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract.
export type ExpenseStatus = components['schemas']['ExpenseItemResponse']['status'];
export type ExpenseCategory = components['schemas']['ExpenseItemResponse']['category'];
export type TripType = components['schemas']['KmLogResponse']['trip_type'];
export type ExportFormat = components['schemas']['ExpenseExportResponse']['format'];
/** The review decision (request enum). */
export type ReviewDecision = 'approve' | 'reject' | 'send_back';

export type KmStop = components['schemas']['KmStopResponse'];

/** A km log — only trip_type / total_km / stops come from the client; the rest are SERVER-computed. */
export type KmLog = components['schemas']['KmLogResponse'];

export type ExpenseItem = components['schemas']['ExpenseItemResponse'];
export type ExpenseItemPage = components['schemas']['ExpenseItemPageResponse'];

/** A category config row — drives the dynamic category list, the receipt rule, and the per-type field schema. */
export type FieldConfig = components['schemas']['FieldConfigResponse'];
/** One per-type capture field definition (EXP-002a). */
export type ExpenseFieldDef = components['schemas']['ExpenseFieldDefResponse'];
/** Derived Alert/Warning validation attached to each item (EXP-013). */
export type ItemValidation = components['schemas']['ItemValidationResponse'];
export type ValidationRule = components['schemas']['ValidationRuleResponse'];
/** Aggregated flagged counts across a scoped set (the approvals/list header). */
export type ValidationSummary = components['schemas']['ValidationSummaryResponse'];

export type ExpenseExport = components['schemas']['ExpenseExportResponse'];

/** Sortable columns for the item DataTable (must match the backend SORTABLE allowlist). */
export type ExpenseSortKey = 'expense_date' | 'amount' | 'status' | 'category' | 'created_at';

/** Server-side filters for the item list (scope is always enforced server-side, §5). */
export interface ExpenseFilters {
  status?: ExpenseStatus;
  category?: ExpenseCategory;
  rep_id?: string;
  client_id?: string;
  pay_period_id?: string;
  from?: string;
  to?: string;
  search?: string;
}

/** The full list params sent to the server (filters + pagination). */
export interface ExpenseListParams extends ExpenseFilters {
  page?: number;
  limit?: number;
  sort?: string;
}

// Request bodies — typed from the generated schema.
export type CreateItemsBody = components['schemas']['CreateExpenseItemsDto'];
export type UpdateItemBody = components['schemas']['UpdateExpenseItemDto'];
export type ReviewBody = components['schemas']['ReviewDto'];
export type BulkReviewBody = components['schemas']['BulkReviewDto'];
export type BulkReviewResult = components['schemas']['BulkReviewResultResponse'];
export type CreateExportBody = components['schemas']['CreateExportDto'];
export type ExpenseItemInput = components['schemas']['ExpenseItemInput'];
export type KmLogInput = components['schemas']['KmLogInput'];
/** The 60s access-controlled receipt URL (GET /v1/expense-items/{id}/receipt-url). */
export type ReceiptUrl = components['schemas']['ReceiptUrlResponse'];
