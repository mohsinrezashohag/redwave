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
export type ExportFormat = components['schemas']['ExportResultResponse']['format'];

export type PayPeriod = components['schemas']['PayPeriodResponse'];

export type RepLite = components['schemas']['RepLiteResponse'];

/**
 * One per-rep computed line: the server's payout components + the net. No tiers and no 70/30 since
 * 2026-11-13: `commission` is the sum of the item rates, paid in full.
 * net = commission + expense + incentive + bonus − clawback, and CAN be negative (never floored).
 */
export type PayRunLine = components['schemas']['PayRunLineResponse'];

/** A pay-run header as returned by the list endpoint (no lines). */
export type PayRunSummary = components['schemas']['PayRunSummaryResponse'];

/** A pay run with its computed lines (draft / get / finalize responses). */
export type PayRun = components['schemas']['PayRunResponse'];

/** The export action's response (no dedicated table — the audit row is the record). */
export type ExportResult = components['schemas']['ExportResultResponse'];

// Request bodies — typed from the generated schema (the backend DID emit request DTOs).
export type CreatePayRunBody = components['schemas']['CreatePayRunDto'];
export type SetBonusBody = components['schemas']['SetBonusDto'];
export type ExportPayRunBody = components['schemas']['ExportPayRunDto'];

/** A rep-facing statement: per sale, what it paid the rep. No client rate, ever (#3). */
export type RepPayStatement = components['schemas']['RepPayStatementResponse'];
export type RepPayStatementSummary = components['schemas']['RepPayStatementSummaryResponse'];
