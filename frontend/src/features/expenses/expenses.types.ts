/**
 * Expenses types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships `@ApiResponse`
 * DTOs as of Batch A #2). Mirrors `backend/src/modules/expenses/dto/expense.response.ts`. Money/km amounts
 * are decimal STRINGS; the km amount is computed SERVER-SIDE. REQUEST bodies are typed from the schema.
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract.
export type ExpenseStatus = components['schemas']['ExpenseReportResponse']['status'];
export type TripType = components['schemas']['KmLogResponse']['trip_type'];
export type ExportFormat = components['schemas']['ExpenseExportResponse']['format'];
/** The review decision (request enum). */
export type ReviewDecision = 'approve' | 'reject' | 'send_back';

export type KmStop = components['schemas']['KmStopResponse'];

/** A km log — only trip_type / total_km / stops come from the client; the rest are SERVER-computed. */
export type KmLog = components['schemas']['KmLogResponse'];

export type ExpenseItem = components['schemas']['ExpenseItemResponse'];

export type ExpenseReport = components['schemas']['ExpenseReportResponse'];

/** A category config row — drives the dynamic category list + the receipt rule. */
export type FieldConfig = components['schemas']['FieldConfigResponse'];

export type ExpenseExport = components['schemas']['ExpenseExportResponse'];

export interface ExpenseFilters {
  status?: ExpenseStatus;
  rep_id?: string;
  client_id?: string;
  pay_period_id?: string;
  from?: string;
  to?: string;
}

// Request bodies — typed from the generated schema (the backend DID emit request DTOs).
export type CreateReportBody = components['schemas']['CreateReportDto'];
export type UpdateReportBody = components['schemas']['UpdateReportDto'];
export type ReviewBody = components['schemas']['ReviewDto'];
export type CreateExportBody = components['schemas']['CreateExportDto'];
export type ExpenseItemInput = components['schemas']['ExpenseItemInput'];
export type KmLogInput = components['schemas']['KmLogInput'];
