/**
 * Pay Run types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/payrun/dto/pay-run.response.ts`. All
 * money is an exact-decimal STRING — the UI NEVER does money arithmetic on it (#1/#5); it only displays via
 * money()/sumMoney(). REQUEST bodies are likewise typed from the generated schema.
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract.
export type PayPeriodStatus = components['schemas']['PayPeriodResponse']['status'];
export type PayRunStatus = components['schemas']['PayRunSummaryResponse']['status'];
export type HoldbackReleaseStatus = components['schemas']['HoldbackLedgerResponse']['release_status'];
export type ExportFormat = components['schemas']['ExportResultResponse']['format'];

export type PayPeriod = components['schemas']['PayPeriodResponse'];

export type RepLite = components['schemas']['RepLiteResponse'];

/**
 * One per-rep computed line. The server provides ONLY these components + the net — there is no tier, no
 * gross, and no current-period 30%-held on the line (those would require UI math; the 30% held is on the
 * holdback ledger after finalize). net = advance + released + expense + incentive + bonus − clawback,
 * and CAN be negative (rendered clearly, never floored).
 */
export type PayRunLine = components['schemas']['PayRunLineResponse'];

/** A pay-run header as returned by the list endpoint (no lines). */
export type PayRunSummary = components['schemas']['PayRunSummaryResponse'];

/** A pay run with its computed lines (draft / get / finalize responses). */
export type PayRun = components['schemas']['PayRunResponse'];

export type HoldbackLedgerEntry = components['schemas']['HoldbackLedgerResponse'];

export interface HoldbackFilters {
  rep_id?: string;
  status?: HoldbackReleaseStatus;
}

/** The export action's response (no dedicated table — the audit row is the record). */
export type ExportResult = components['schemas']['ExportResultResponse'];

// Request bodies — typed from the generated schema (the backend DID emit request DTOs).
export type CreatePayRunBody = components['schemas']['CreatePayRunDto'];
export type SetBonusBody = components['schemas']['SetBonusDto'];
export type ExportPayRunBody = components['schemas']['ExportPayRunDto'];
