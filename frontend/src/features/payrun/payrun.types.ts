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
 * One per-rep computed line. The server provides the payout components + the net, PLUS the engine's
 * reconciliation facts — `gross_commission` (the 70/30 base), `amount_held` (THIS period's 30%),
 * `tier_at_payment`, `internet_tally`, `rate_per_activation` — so the split is provable WITHOUT any UI
 * math (#1/#5): gross === commission_70 + amount_held, always. Those five are null only on rows created
 * before the reconciliation migration (and tier/rate are null when the internet tally is 0).
 * net = advance + released + expense + incentive + bonus − clawback, and CAN be negative (never floored).
 */
export type PayRunLine = components['schemas']['PayRunLineResponse'];

/** A pay-run header as returned by the list endpoint (no lines). */
export type PayRunSummary = components['schemas']['PayRunSummaryResponse'];

/** A pay run with its computed lines (draft / get / finalize responses). */
export type PayRun = components['schemas']['PayRunResponse'];

export type HoldbackLedgerEntry = components['schemas']['HoldbackLedgerResponse'];

/**
 * The run's period-level 30% (deferred pay) view. EVERY figure is server-computed — the UI renders these
 * verbatim and never aggregates the ledger itself. `is_projection` is true on a draft (the current hold and
 * its release period are projected; nothing is written to the ledger until finalize).
 */
export type PayRunHoldbackSummary = components['schemas']['PayRunHoldbackSummaryResponse'];

/** One origin period's hold within the summary (what was held, and when it releases). */
export type HoldbackByOrigin = components['schemas']['HoldbackByOriginResponse'];

/** A pay period reduced to what the holdback summary needs to name a release period. */
export type HoldbackPeriodRef = components['schemas']['HoldbackPeriodRefResponse'];

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
