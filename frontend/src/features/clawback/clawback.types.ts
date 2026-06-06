/**
 * Clawback types — RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/clawback/dto/clawback.response.ts`.
 * The clawback list/get returns FLAT records (no nested sale/rep/product) — the UI links to the sale via
 * `sale_id` and maps `applied_in_pay_run_id` to a period via the pay-run list. The recovery `amount` is the
 * SERVER's engine calc (rate + incentive off the frozen snapshot) — the UI never computes it (#1/#6).
 */
import type { components } from '../../api/generated/schema';

export type ClawbackStatus = components['schemas']['ClawbackResponse']['status'];

export type Clawback = components['schemas']['ClawbackResponse'];

export interface ClawbackFilters {
  status?: ClawbackStatus;
  rep_id?: string;
  sale_id?: string;
}

// Request body — typed from the generated schema. `amount` is OPTIONAL: omit it to let the server compute
// the exact amount paid from the frozen snapshot (#1/#6); send a value only to override.
export type CreateClawbackBody = components['schemas']['CreateClawbackDto'];
